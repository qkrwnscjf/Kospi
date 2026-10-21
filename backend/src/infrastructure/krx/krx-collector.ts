import { producer, TOPICS, ensureTopics } from '../kafka.js';
import { Counter, Gauge, Latency, metricsConfig, startMetricsLog, startMetricsServer } from '../metrics.js';
import { registerShutdown } from '../shutdown.js';
import { KRX_DAILY_INDICES, KRX_DAILY_KEYS, type KrxEndpoint } from '../../shared/krx-indices.js';
import { fetchDailyIndexCoverage } from '../backend-coverage.js';
import type { TickData } from '../../shared/types.js';
import { KrxApiError, KrxClient, readKrxConfig } from './krx-client.js';
import { combineCoverage, ENDPOINT_PATHS, FIELDS, mapIndexRows, missingDates, rowsOf, seoulWeekdays } from './krx-index-daily.js';
import { safeLogList } from '../http-json.js';

// KRX 일별 지수 수집기 (docs/Task_ORDER.md T-67, D-60)
// VKOSPI와 KRX 섹터 5종의 일별 종가를 KRX Open API에서 받아 Kafka `index-daily`로 보낸다.
// - KRX 키를 가진 컨테이너는 이 수집기 하나뿐이다. 키가 없으면 접속하지 않고 대기한다.
// - 시작할 때 최근 KRX_BACKFILL_DAYS일(기본 370일)을 한 번 채우고, 이후에는 KRX_POLLING_INTERVAL_MS마다 최근 7일만 다시 확인한다.
//   DB는 (symbol, time) 기준으로 덮어쓰므로 다시 보내도 중복이 생기지 않는다.
// - 값이 바뀐(또는 새로 생긴) 날짜만 보낸다.

const readIntEnv = (name: string, fallback: number) => {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isNaN(value) ? fallback : value;
};
const BACKFILL_DAYS = readIntEnv('KRX_BACKFILL_DAYS', 370);
const POLLING_INTERVAL_MS = readIntEnv('KRX_POLLING_INTERVAL_MS', 30 * 60_000);
const RECENT_DAYS = 7;
const REQUEST_GAP_MS = 200; // 호출 사이 간격 (KRX 호출 제한 보호)
const MAX_BACKOFF_MS = 6 * 60 * 60_000;
const ENDPOINTS: KrxEndpoint[] = ['krx', 'drvprod'];

const fetchTotal = new Counter('kospi_krx_fetch_total', 'KRX daily index fetches by endpoint and result (ok / empty / error)');
const fetchDuration = new Latency('kospi_krx_fetch_duration_seconds', 'KRX daily index fetch duration');
const sentTotal = new Counter('kospi_krx_ticks_sent_total', 'Daily index values sent to Kafka by symbol');
const invalidTotal = new Counter('kospi_krx_invalid_rows_total', 'Target index rows dropped because a value was missing, by symbol');
const configured = new Gauge('kospi_krx_configured', 'Whether the KRX API key is configured (1) or not (0)');
const lastSuccessAt = new Gauge('kospi_krx_last_success_timestamp_seconds', 'Unix time of the last successful KRX fetch, by endpoint');
const latestTradeDate = new Gauge('kospi_krx_latest_trade_date', 'Latest trade date received (YYYYMMDD as a number), by symbol');

const lastSent = new Map<string, string>();
const loggedFields = new Set<KrxEndpoint>();
const loggedMissing = new Set<KrxEndpoint>();
let stopping = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let consecutiveFailures = 0;

// 인증 거부(401/403)를 받은 엔드포인트는 한동안 호출하지 않는다 (키 미승인 상태에서 반복 호출 방지).
// KRX Open API는 키 발급 후 서비스(API)별로 이용 신청·승인을 받아야 호출할 수 있다.
const AUTH_RETRY_MS = 6 * 60 * 60_000;
const disabledUntil = new Map<KrxEndpoint, number>();
const backfilled = new Set<KrxEndpoint>();
const unauthorized = new Counter('kospi_krx_unauthorized_total', 'KRX requests rejected as unauthorized (401/403), by endpoint');
const RATE_LIMIT_RETRY_MS = 60 * 60_000;
const rateLimited = new Counter('kospi_krx_rate_limited_total', 'KRX requests rejected by rate limit (429), by endpoint');
const isEnabled = (endpoint: KrxEndpoint) => (disabledUntil.get(endpoint) ?? 0) <= Date.now();

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function describeError(error: unknown) {
  if (error instanceof KrxApiError) return `${error.message}${error.status ? ` status=${error.status}` : ''}${error.code ? ` code=${error.code}` : ''}`;
  return 'unexpected_error';
}

// 한 날짜·한 엔드포인트를 받아 바뀐 값만 Kafka로 보낸다. 성공하면 true
async function collectDay(client: KrxClient, endpoint: KrxEndpoint, basDd: string) {
  const startedAt = Date.now();
  try {
    const body = await client.get(ENDPOINT_PATHS[endpoint], basDd);
    fetchDuration.observe({}, Date.now() - startedAt);
    const rows = rowsOf(body);

    // 필드 매핑 확정용: 첫 응답의 필드 이름만 한 번 남긴다 (값은 남기지 않음)
    if (!loggedFields.has(endpoint) && rows[0]) {
      loggedFields.add(endpoint);
      console.log(`[krx] ${endpoint} response fields: ${safeLogList(Object.keys(rows[0]))}`);
    }
    if (rows.length === 0) {
      fetchTotal.inc({ endpoint, result: 'empty' });
      return true;
    }
    fetchTotal.inc({ endpoint, result: 'ok' });
    lastSuccessAt.set({ endpoint }, Math.floor(Date.now() / 1000));

    const { ticks, invalid } = mapIndexRows(endpoint, basDd, rows);
    for (const symbol of invalid) invalidTotal.inc({ symbol });
    // 대상 지수 이름이 응답에 없으면 한 번만 공개 지수 이름 일부를 남긴다 (이름 표 확정용)
    if (ticks.length === 0 && invalid.length === 0 && !loggedMissing.has(endpoint)) {
      loggedMissing.add(endpoint);
      const names = rows.map(row => row[FIELDS.name]).filter((name): name is string => typeof name === 'string');
      console.warn(`[krx] ${endpoint} ${basDd}: no target index matched among ${rows.length} rows. Names: ${safeLogList(names)}`);
    }

    const changed = ticks.filter(tick => lastSent.get(`${tick.symbol}|${basDd}`) !== `${tick.price}|${tick.changeRate}`);
    if (changed.length > 0) {
      const producedAt = Date.now();
      await producer.send({
        topic: TOPICS.indexDaily,
        messages: changed.map((tick: TickData) => ({
          key: tick.symbol,
          value: JSON.stringify({ ...tick, collectedAt: startedAt, producedAt }),
        })),
      });
      for (const tick of changed) {
        lastSent.set(`${tick.symbol}|${basDd}`, `${tick.price}|${tick.changeRate}`);
        sentTotal.inc({ symbol: tick.symbol });
        latestTradeDate.set({ symbol: tick.symbol }, Math.max(Number(basDd), 0));
      }
    }
    return true;
  } catch (error) {
    fetchDuration.observe({}, Date.now() - startedAt);
    fetchTotal.inc({ endpoint, result: 'error' });
    if (error instanceof KrxApiError && (error.status === 401 || error.status === 403)) {
      unauthorized.inc({ endpoint });
      disabledUntil.set(endpoint, Date.now() + AUTH_RETRY_MS);
      console.warn(`[krx] ${endpoint} rejected as unauthorized (${describeError(error)}). ` +
        `Check that this API service is approved for the key on the KRX Open API portal. Pausing this endpoint for ${AUTH_RETRY_MS / 3600_000}h.`);
      return false;
    }
    // 호출 제한(429)이면 과거 채우기가 날짜마다 계속 호출하지 않도록 그 엔드포인트를 1시간 멈춘다
    if (error instanceof KrxApiError && error.status === 429) {
      rateLimited.inc({ endpoint });
      disabledUntil.set(endpoint, Date.now() + RATE_LIMIT_RETRY_MS);
      console.warn(`[krx] ${endpoint} rate limited (${describeError(error)}). Pausing this endpoint for ${RATE_LIMIT_RETRY_MS / 60_000}m.`);
      return false;
    }
    console.warn(`[krx] ${endpoint} ${basDd} fetch failed: ${describeError(error)}`);
    return false;
  }
}

// 날짜들을 오래된 순서로 받는다 (화면의 최신값이 마지막에 가장 최근 날짜로 남도록). 거부된 엔드포인트는 건너뛴다.
async function collectDays(client: KrxClient, dates: string[], endpoints: KrxEndpoint[]) {
  let failures = 0;
  for (const basDd of dates) {
    for (const endpoint of endpoints) {
      if (stopping) return failures === 0;
      if (!isEnabled(endpoint)) continue;
      if (!(await collectDay(client, endpoint, basDd))) failures += 1;
      await sleep(REQUEST_GAP_MS);
    }
  }
  return failures === 0;
}

// 과거 채우기: 이미 저장된 기간은 backend에 물어서 건너뛰고 빠진 날짜만 받는다 (docs/security.md SEC-014).
// 저장 범위를 확인하지 못하면 이번에는 채우지 않고 다음 주기에 다시 묻는다(재시작이 반복돼도 대량 호출이 생기지 않게).
// 받을 날짜가 있으면 먼저 최근 1개 거래일로 인증을 확인하고, 통과한 엔드포인트만 채운다. 최근 7일은 loop가 받는다.
const ENDPOINT_SYMBOLS: Record<KrxEndpoint, string[]> = {
  krx: KRX_DAILY_KEYS.filter(symbol => KRX_DAILY_INDICES[symbol].endpoint === 'krx'),
  drvprod: KRX_DAILY_KEYS.filter(symbol => KRX_DAILY_INDICES[symbol].endpoint === 'drvprod'),
};
let loggedCoverageUnavailable = false;

async function backfill(client: KrxClient) {
  if (BACKFILL_DAYS <= RECENT_DAYS) return;
  const pending = ENDPOINTS.filter(endpoint => !backfilled.has(endpoint) && isEnabled(endpoint));
  if (stopping || pending.length === 0) return;

  const coverage = await fetchDailyIndexCoverage(pending.flatMap(endpoint => ENDPOINT_SYMBOLS[endpoint]));
  if (!coverage) {
    if (!loggedCoverageUnavailable) console.warn('[krx] stored range unavailable from backend; backfill postponed to the next cycle');
    loggedCoverageUnavailable = true;
    return;
  }

  const recent = seoulWeekdays(Date.now(), RECENT_DAYS);
  const target = seoulWeekdays(Date.now(), BACKFILL_DAYS).slice(0, -recent.length);
  for (const endpoint of pending) {
    if (stopping) return;
    const stored = combineCoverage(ENDPOINT_SYMBOLS[endpoint].map(symbol => coverage.get(symbol)));
    const dates = missingDates(target, stored);
    if (dates.length === 0) {
      backfilled.add(endpoint);
      console.log(`[krx] ${endpoint} backfill skipped: already stored ${stored?.earliest}-${stored?.latest}`);
      continue;
    }
    const probe = recent[recent.length - 1];
    if (probe && !(await collectDay(client, endpoint, probe)) && !isEnabled(endpoint)) continue;
    const startedAt = Date.now();
    const ok = await collectDays(client, dates, [endpoint]);
    if (!isEnabled(endpoint)) continue; // 채우는 중에 거부되면 다음에 다시
    backfilled.add(endpoint);
    console.log(`[krx] ${endpoint} backfill ${ok ? 'done' : 'finished with errors'}: ${dates.length} of ${target.length} trade days (stored ${stored ? `${stored.earliest}-${stored.latest}` : 'none'}) in ${Math.round((Date.now() - startedAt) / 1000)}s`);
  }
}

async function loop(client: KrxClient) {
  if (stopping) return;
  await backfill(client);
  const ok = await collectDays(client, seoulWeekdays(Date.now(), RECENT_DAYS), ENDPOINTS);
  consecutiveFailures = ok ? 0 : consecutiveFailures + 1;
  const delay = consecutiveFailures === 0 ? POLLING_INTERVAL_MS : Math.min(POLLING_INTERVAL_MS * 2 ** consecutiveFailures, MAX_BACKOFF_MS);
  if (!stopping) timer = setTimeout(() => void loop(client), delay);
}

async function main() {
  console.log('KRX collector starting...');
  startMetricsServer(metricsConfig.port);
  startMetricsLog('krx-collector', metricsConfig.logIntervalMs);

  const config = readKrxConfig();
  if (!config) {
    configured.set({}, 0);
    console.warn('[krx] KRX_API_KEY is not configured. Daily index collection is idle.');
    registerShutdown('krx-collector', []);
    return;
  }
  configured.set({}, 1);

  await producer.connect();
  await ensureTopics();
  const client = new KrxClient(config);
  registerShutdown('krx-collector', [
    { name: 'poll loop', run: () => { stopping = true; clearTimeout(timer); } },
    { name: 'kafka producer', run: () => producer.disconnect() },
  ]);

  console.log(`[krx] configured for ${KRX_DAILY_KEYS.length} indices. Backfill ${BACKFILL_DAYS} days, then every ${POLLING_INTERVAL_MS}ms.`);
  void loop(client);
}

main().catch(error => {
  console.error(`KRX collector failed to start: ${error instanceof Error ? error.message : 'unexpected_error'}`);
  process.exit(1);
});
