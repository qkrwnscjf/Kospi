import { fetchYahooData } from './yahoo-api.js';
import { fetchNaverData } from './naver-api.js';
import type { NormalizedMarketData } from './normalizer.js';
import { MARKETS, YAHOO_MARKET, decideMarketStatus } from './market-hours.js';
import { YAHOO_KEYS, isYahooSymbolKey } from '../../shared/symbols.js';
import type { YahooSymbolKey } from '../../shared/symbols.js';
import type { MarketState } from '../../shared/market-state.js';
import { producer, TOPICS, ensureTopics } from '../kafka.js';
import { Counter, Gauge, Latency, metricsConfig, startMetricsLog, startMetricsServer } from '../metrics.js';
import { registerShutdown } from '../shutdown.js';

const readIntEnv = (name: string, fallback: number) => Number.parseInt(process.env[name] ?? '', 10) || fallback;

// 기본 10초. B-02 측정을 위해 환경변수로 바꿀 수 있게 했다 (docs/Task_ORDER.md T-30)
const POLLING_INTERVAL_MS = readIntEnv('POLLING_INTERVAL_MS', 10000);
// 소스별 수집 시간 제한. 넘기면 실패로 보고 그 주기를 넘긴다 (docs/Task_ORDER.md T-04)
const FETCH_TIMEOUT_MS = readIntEnv('FETCH_TIMEOUT_MS', 3000);
// 연속 실패 시 대기 시간 상한 (docs/Task_ORDER.md T-04)
const MAX_BACKOFF_MS = readIntEnv('MAX_BACKOFF_MS', 60000);
// 모든 시장이 닫혀 있을 때의 polling 주기 (docs/Task_ORDER.md T-07, D-16)
const IDLE_POLLING_INTERVAL_MS = readIntEnv('IDLE_POLLING_INTERVAL_MS', 60000);
// 시간표상 장 시간인데 소스가 휴장(공휴일 등)일 때의 주기 (T-56, D-40).
// 휴장일의 호출을 줄이면서, 다음 날 개장은 이 주기 안에 알아채도록 유휴 주기보다 짧게 둔다.
const HOLIDAY_POLLING_INTERVAL_MS = readIntEnv('HOLIDAY_POLLING_INTERVAL_MS', 15000);
// 검증용: 장 시간을 판단할 때만 시계를 옮긴다(기본 0). 실제 수집 시각과 데이터에는 영향이 없다 (T-07)
const MARKET_CLOCK_OFFSET_MS = Number.parseInt(process.env.MARKET_CLOCK_OFFSET_MS ?? '', 10) || 0;
// Naver 수집은 보류 중(R-03)이라 기본값은 끔. "true"일 때만 수집한다 (docs/Task_ORDER.md T-10, D-15)
const NAVER_ENABLED = process.env.NAVER_ENABLED === 'true';
// 검증용: true이면 시작할 때 잘못된 메시지 2건을 한 번 보낸다(기본 끔). 컨슈머 방어(T-13)를 확인하기 위함
const KAFKA_TEST_INJECT_INVALID = process.env.KAFKA_TEST_INJECT_INVALID === 'true';
// 검증용: true이면 변경 감지(T-06)를 건너뛰고 매 주기 모두 전송한다(기본 끔).
// 장이 닫힌 시간(주말)에도 실시간 경로(Kafka → Gateway → WebSocket)의 지연을 측정하기 위함 (T-23, B-05).
// 같은 (symbol, time)은 DB Sink의 유니크 제약(T-15)으로 건너뛰도록 되어 있다.
const WORKER_TEST_SEND_UNCHANGED = process.env.WORKER_TEST_SEND_UNCHANGED === 'true';

// 측정 지표 (docs/Task_ORDER.md T-01)
const fetchDuration = new Latency('kospi_worker_fetch_duration_seconds', 'External API fetch duration by source');
const fetchTotal = new Counter('kospi_worker_fetch_total', 'External API fetch attempts by source and result (success / empty / timeout / error)');
const itemsTotal = new Counter('kospi_worker_items_total', 'Items fetched by source');
const collectLag = new Latency('kospi_worker_collect_lag_seconds', 'Source timestamp to worker collection time by symbol');
const kafkaSendDuration = new Latency('kospi_worker_kafka_send_duration_seconds', 'Kafka producer send duration');
const cycleDuration = new Latency('kospi_worker_cycle_duration_seconds', 'One polling cycle duration (fetch + Kafka)');

// 소스 갱신 주기 측정 (docs/Task_ORDER.md T-03, BENCHMARK M-04)
const sourceUpdateInterval = new Latency('kospi_worker_source_update_interval_seconds', 'Interval between consecutive new source timestamps by symbol');
const sourcePollTotal = new Counter('kospi_worker_source_poll_total', 'Polls by symbol and result (new_timestamp / same_timestamp)');
const lastSourceTimestamp = new Map<string, number>();

// 수집 루프 상태 (docs/Task_ORDER.md T-04)
const cycleStartInterval = new Latency('kospi_worker_cycle_start_interval_seconds', 'Interval between consecutive polling cycle starts');
const backoffTotal = new Counter('kospi_worker_backoff_total', 'Polling cycles scheduled with backoff after a failed Yahoo fetch');
const pollDelay = new Gauge('kospi_worker_poll_delay_seconds', 'Currently applied delay between polling cycles');
const marketOpen = new Gauge('kospi_worker_market_open', 'Whether each market is in regular trading hours (1) or not (0)');

// 변경 감지 (docs/Task_ORDER.md T-06, D-13). 심볼별로 마지막으로 Kafka 전송에 성공한 소스 시각.
const tickTotal = new Counter('kospi_worker_tick_total', 'Collected ticks by symbol and result (sent / skipped_unchanged)');
const lastSentTimestamp = new Map<string, number>();
// 장 상태가 바뀌면 시각이 같아도 한 번 보낸다. 화면의 "장중 / 휴장" 표시가 바뀌게 하기 위함 (T-56)
const lastSentMarketState = new Map<string, MarketState>();

// 지표별로 가장 최근에 받은 소스 장 상태 (전송 여부와 상관없이). 수집 주기 판단에 쓴다 (T-56)
const latestSourceState = new Map<YahooSymbolKey, MarketState>();
let lastSourceStateSummary: string | undefined;

type CollectedMarketData = NormalizedMarketData & { collectedAt: number };
type FetchResult = 'success' | 'empty' | 'timeout' | 'error';

class FetchTimeoutError extends Error {}

// 정해진 시간 안에 끝나지 않으면 실패로 처리한다. 원래 요청은 중단되지 않고 결과만 버려진다.
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new FetchTimeoutError(`timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Yahoo는 timestamp에 소스 기준 시각(regularMarketTime)을 넣으므로, 이 값이 바뀌는 간격이 곧 소스 갱신 주기다.
// Naver는 수집 시각(Date.now())을 넣기 때문에 측정 대상에서 제외한다.
function trackSourceUpdate(item: NormalizedMarketData) {
  const previous = lastSourceTimestamp.get(item.ticker);
  lastSourceTimestamp.set(item.ticker, item.timestamp);
  if (previous === undefined) return;

  if (item.timestamp > previous) {
    sourceUpdateInterval.observe({ symbol: item.ticker }, item.timestamp - previous);
    sourcePollTotal.inc({ symbol: item.ticker, result: 'new_timestamp' });
  } else {
    sourcePollTotal.inc({ symbol: item.ticker, result: 'same_timestamp' });
  }
}

// 소스별 응답 시간과 수집 시각을 기록한다. 결과는 success / empty(0건) / timeout / error로 나눈다 (T-04, T-05).
// Naver 어댑터는 아직 에러를 삼키고 []를 반환하므로, Naver의 에러는 empty로 집계된다.
async function collect(
  source: string,
  fetcher: () => Promise<NormalizedMarketData[]>
): Promise<{ result: FetchResult; items: CollectedMarketData[] }> {
  const startedAt = Date.now();
  let items: NormalizedMarketData[] = [];
  let result: FetchResult;

  try {
    items = await withTimeout(fetcher(), FETCH_TIMEOUT_MS);
    result = items.length > 0 ? 'success' : 'empty';
  } catch (error) {
    if (error instanceof FetchTimeoutError) {
      result = 'timeout';
      console.warn(`[${source}] fetch ${error.message}`);
    } else {
      result = 'error';
      console.error(`[${source}] fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const collectedAt = Date.now();

  fetchDuration.observe({ source }, collectedAt - startedAt);
  fetchTotal.inc({ source, result });
  itemsTotal.inc({ source }, items.length);

  return {
    result,
    items: items.map(item => {
      collectLag.observe({ symbol: item.ticker }, collectedAt - item.timestamp);
      if (source === 'yahoo') {
        trackSourceUpdate(item);
      }
      return { ...item, collectedAt };
    }),
  };
}

// 수집 1회: 외부 API 조회 → DB 적재 → Kafka 전송. Yahoo 수집 결과를 돌려준다 (백오프 판단용).
async function runCycle(): Promise<FetchResult> {
  console.log(`\n[${new Date().toISOString()}] Fetching market data...`);

  // 두 요청을 먼저 모두 시작한 뒤 기다린다 (동시 수집). Naver는 켜져 있을 때만 요청한다 (T-10).
  const yahooPromise = collect('yahoo', fetchYahooData);
  const naverPromise = NAVER_ENABLED ? collect('naver', fetchNaverData) : undefined;
  const yahoo = await yahooPromise;
  const naver = naverPromise ? await naverPromise : undefined;

  const allData = [...yahoo.items, ...(naver?.items ?? [])];

  // 소스 장 상태 기록 (T-56)
  for (const item of yahoo.items) {
    if (item.marketState && isYahooSymbolKey(item.ticker)) {
      latestSourceState.set(item.ticker, item.marketState);
    }
  }
  const sourceSummary = YAHOO_KEYS.map(key => `${key}=${latestSourceState.get(key) ?? '?'}`).join(' ');
  if (sourceSummary !== lastSourceStateSummary) {
    console.log(`Source market states: ${sourceSummary}`);
    lastSourceStateSummary = sourceSummary;
  }

  // 변경 감지 (T-06, D-13): 마지막으로 전송한 소스 시각보다 새로운 tick만 보낸다.
  // 시각이 바뀌었다면 가격이 같아도 새 tick으로 본다. 장 상태가 바뀐 경우도 보낸다 (T-56).
  const freshData = allData.filter(data => {
    const lastSent = lastSentTimestamp.get(data.ticker);
    const stateChanged = data.marketState !== undefined && data.marketState !== lastSentMarketState.get(data.ticker);
    const isNew = WORKER_TEST_SEND_UNCHANGED || lastSent === undefined || data.timestamp > lastSent || stateChanged;
    if (!isNew) {
      tickTotal.inc({ symbol: data.ticker, result: 'skipped_unchanged' });
    }
    return isNew;
  });

  try {
    if (allData.length > 0 && freshData.length === 0) {
      console.log(`Fetched ${allData.length} items, no new ticks.`);
    }
    if (freshData.length > 0) {
      console.log(`Successfully fetched ${allData.length} items (${freshData.length} new). Sending to Kafka...`);

      // Kafka 전송. DB 저장은 DB Sink가 Kafka에서 읽어서 한다 (docs/Task_ORDER.md T-12, D-18).
      // 이전에는 여기서 DB 저장이 끝나야 전송이 시작되어, DB 지연이 곧 실시간 지연이었다.
      const producedAt = Date.now();
      const messages = freshData.map(data => {
        // Map ticker to symbol for internal TickData usage
        const tickData = {
          symbol: data.ticker,
          category: data.category,
          price: data.price,
          changeRate: data.changeRate,
          changePrice: data.changePrice,
          timestamp: data.timestamp,
          volume: data.volume,
          collectedAt: data.collectedAt,
          producedAt,
          marketState: data.marketState,
        };

        return {
          key: data.ticker,
          value: JSON.stringify(tickData)
        };
      });

      await producer.send({ topic: TOPICS.ticks, messages });
      kafkaSendDuration.observe({}, Date.now() - producedAt);

      // 전송에 성공한 뒤에만 "마지막 전송 시각"을 갱신한다. 실패하면 다음 주기에 다시 보낼 수 있도록.
      for (const data of freshData) {
        lastSentTimestamp.set(data.ticker, Math.max(data.timestamp, lastSentTimestamp.get(data.ticker) ?? 0));
        if (data.marketState) lastSentMarketState.set(data.ticker, data.marketState);
        tickTotal.inc({ symbol: data.ticker, result: 'sent' });
      }

      // 콘솔 출력 테스트 (상위 3개만)
      console.log('Sample Data Sent:', freshData.slice(0, 3).map(d => d.ticker));
    }
  } catch (error) {
    // Kafka 전송 실패는 백오프하지 않는다 (외부 API 보호가 백오프의 목적)
    console.error('Worker loop error:', error);
  }

  return yahoo.result;
}

// 수집 루프 (docs/Task_ORDER.md T-04)
// - 이전 수집이 끝난 뒤에만 다음 수집을 예약하므로 겹쳐서 실행되지 않는다.
// - 정상일 때는 수집 시작 시각 기준으로 POLLING_INTERVAL_MS 간격을 유지한다.
// - Yahoo 수집이 실패하면 대기 시간을 2배씩 늘린다 (상한 MAX_BACKOFF_MS). 성공하면 바로 원래 간격으로 돌아온다.
//   Naver는 보류 중(R-03)이고 항상 0건이라 판단에서 제외한다.
let consecutiveFailures = 0;
let lastCycleStartedAt: number | undefined;
let lastMarketSummary: string | undefined;

// 종료 처리 (docs/Task_ORDER.md T-28): 다음 수집 예약을 취소하고, 진행 중인 수집이 끝날 때까지 기다린다.
let stopping = false;
let nextPollTimer: ReturnType<typeof setTimeout> | undefined;
let currentCycle: Promise<void> | undefined;

// 시장 상태에 따라 기본 주기를 정한다 (T-07, D-16, T-56).
// 하나라도 장중이면 활성 주기, 장중은 없고 휴장(시간표상 장 시간인데 소스가 닫힘)이 있으면 휴장 주기, 모두 닫혀 있으면 유휴 주기.
// Yahoo는 요청 한 번에 모든 지표를 돌려주므로 지표별로 다른 주기를 줄 수 없다.
function baseInterval() {
  const now = new Date(Date.now() + MARKET_CLOCK_OFFSET_MS);
  const states = MARKETS.map(market => {
    const sourceStates = YAHOO_KEYS.filter(key => YAHOO_MARKET[key] === market.id).map(key => latestSourceState.get(key));
    return { id: market.id, status: decideMarketStatus(market.isOpen(now), sourceStates) };
  });
  for (const state of states) {
    marketOpen.set({ market: state.id }, state.status === 'open' ? 1 : 0);
  }

  const interval = states.some(state => state.status === 'open')
    ? POLLING_INTERVAL_MS
    : states.some(state => state.status === 'holiday')
      ? HOLIDAY_POLLING_INTERVAL_MS
      : IDLE_POLLING_INTERVAL_MS;
  const summary = states.map(state => `${state.id}=${state.status}`).join(' ');
  if (summary !== lastMarketSummary) {
    console.log(`Market hours: ${summary} -> polling every ${interval}ms`);
    lastMarketSummary = summary;
  }
  return interval;
}

function pollLoop() {
  if (stopping) return;
  currentCycle = pollOnce().finally(() => {
    currentCycle = undefined;
  });
}

async function pollOnce() {
  const cycleStartedAt = Date.now();
  if (lastCycleStartedAt !== undefined) {
    cycleStartInterval.observe({}, cycleStartedAt - lastCycleStartedAt);
  }
  lastCycleStartedAt = cycleStartedAt;

  let yahooResult: FetchResult = 'empty';
  try {
    yahooResult = await runCycle();
  } catch (error) {
    console.error('Worker loop error:', error);
  }
  cycleDuration.observe({}, Date.now() - cycleStartedAt);

  consecutiveFailures = yahooResult === 'success' ? 0 : consecutiveFailures + 1;
  const interval = baseInterval();
  // 백오프 상한은 현재 주기보다 짧아지지 않게 한다 (유휴 주기 60초가 백오프 때문에 줄어들지 않도록)
  const targetDelay = consecutiveFailures === 0
    ? interval
    : Math.min(interval * 2 ** consecutiveFailures, Math.max(MAX_BACKOFF_MS, interval));

  if (consecutiveFailures > 0) {
    backoffTotal.inc();
    console.warn(`Yahoo fetch ${yahooResult}: backing off, next poll in ${targetDelay}ms (consecutive failures: ${consecutiveFailures})`);
  }
  pollDelay.set({}, targetDelay / 1000);

  if (!stopping) {
    nextPollTimer = setTimeout(pollLoop, Math.max(0, targetDelay - (Date.now() - cycleStartedAt)));
  }
}

async function stopPolling() {
  stopping = true;
  clearTimeout(nextPollTimer);
  await currentCycle;
}

async function runIngestionWorker() {
  console.log('🚀 Data Ingestion Worker Started...');
  console.log(`Polling interval: ${POLLING_INTERVAL_MS}ms, fetch timeout: ${FETCH_TIMEOUT_MS}ms, max backoff: ${MAX_BACKOFF_MS}ms`);
  console.log(`Naver collection: ${NAVER_ENABLED ? 'enabled' : 'disabled (on hold, R-03)'}`);
  console.log(`Idle polling interval (all markets closed): ${IDLE_POLLING_INTERVAL_MS}ms, holiday interval (source closed during market hours): ${HOLIDAY_POLLING_INTERVAL_MS}ms`);
  if (MARKET_CLOCK_OFFSET_MS !== 0) {
    console.warn(`MARKET_CLOCK_OFFSET_MS=${MARKET_CLOCK_OFFSET_MS}: market hours are evaluated on a shifted clock (verification only).`);
  }
  if (FETCH_TIMEOUT_MS >= POLLING_INTERVAL_MS) {
    console.warn('FETCH_TIMEOUT_MS is not shorter than POLLING_INTERVAL_MS: cycles may start later than the configured interval.');
  }

  await producer.connect();
  console.log('Connected to Kafka producer.');
  const partitions = await ensureTopics();
  console.log(`Kafka topic ${TOPICS.ticks} ready (${partitions} partitions).`);

  if (KAFKA_TEST_INJECT_INVALID) {
    await producer.send({
      topic: TOPICS.ticks,
      messages: [
        { key: 'TEST', value: 'not-json' },
        { key: 'TEST', value: JSON.stringify({ symbol: 'KOSPI', category: 'domestic', price: -1, changeRate: 0, timestamp: Date.now() }) },
      ],
    });
    console.warn('KAFKA_TEST_INJECT_INVALID=true: sent 2 invalid test messages (verification only).');
  }
  if (WORKER_TEST_SEND_UNCHANGED) {
    console.warn('WORKER_TEST_SEND_UNCHANGED=true: change detection is off, every polled tick is sent (verification only).');
  }

  // Kafka 연결 성공 후에 시작한다. 연결 실패 시 메트릭 서버 때문에 프로세스가 살아남지 않도록.
  startMetricsServer(metricsConfig.port);
  startMetricsLog('worker', metricsConfig.logIntervalMs);
  console.log(`Metrics server listening on :${metricsConfig.port} (internal only)`);

  registerShutdown('worker', [
    { name: 'poll loop', run: () => stopPolling() },
    { name: 'kafka producer', run: () => producer.disconnect() },
  ]);

  pollLoop();
}

// 시작에 실패하면(예: Kafka 연결 재시도 소진) 종료 코드 1로 끝낸다.
// docker-compose의 restart: on-failure가 다시 띄우도록 하기 위함 (docs/Task_ORDER.md T-08, P-11).
runIngestionWorker().catch(error => {
  console.error('Worker failed to start:', error);
  process.exit(1);
});
