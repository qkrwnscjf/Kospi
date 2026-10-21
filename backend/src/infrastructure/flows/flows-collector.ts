import { producer, TOPICS, ensureTopics } from '../kafka.js';
import { Counter, Gauge, Latency, metricsConfig, startMetricsLog, startMetricsServer } from '../metrics.js';
import { registerShutdown } from '../shutdown.js';
import { MARKETS } from '../ingestion/market-hours.js';
import { FLOW_MARKETS, type FlowMarket, type InvestorFlow } from '../../shared/flows.js';
import { KisApiError, KisClient, readKisConfig } from './kis-client.js';
import { fetchInvestorFlow } from './kis-investor-flows.js';

// 증시 자금 흐름 수집기 (docs/Task_ORDER.md 11단계 A, D-53)
// KIS "시장별 투자자매매동향"을 장중에 주기적으로 조회해서 Kafka `investor-flows`로 보낸다.
// - 증권사 키를 가진 컨테이너는 이 수집기 하나뿐이다 (D-43). 키가 없으면 수집하지 않고 대기한다.
// - 값이 바뀐 경우에만 보낸다 (T-06과 같은 변경 감지).
// - 장 시간 밖에는 조회하지 않는다. 공휴일은 KIS 응답이 바뀌지 않아 변경 감지로 전송이 생기지 않는다.

const readIntEnv = (name: string, fallback: number) => Number.parseInt(process.env[name] ?? '', 10) || fallback;
const POLLING_INTERVAL_MS = readIntEnv('FLOWS_POLLING_INTERVAL_MS', 30_000);
const IDLE_CHECK_INTERVAL_MS = 60_000;
const MAX_BACKOFF_MS = 5 * 60_000;

const fetchTotal = new Counter('kospi_flows_fetch_total', 'KIS investor flow fetches by market and result (sent / unchanged / invalid / error)');
const fetchDuration = new Latency('kospi_flows_fetch_duration_seconds', 'KIS investor flow fetch duration');
const kafkaSendDuration = new Latency('kospi_flows_kafka_send_duration_seconds', 'Kafka send duration for investor flows');
const configured = new Gauge('kospi_flows_configured', 'Whether KIS credentials are configured (1) or not (0)');
const lastSuccessAt = new Gauge('kospi_flows_last_success_timestamp_seconds', 'Unix time of the last successful KIS fetch, by market');

const lastSent = new Map<FlowMarket, string>();
let stopping = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let consecutiveFailures = 0;

const krxOpen = () => MARKETS.find(market => market.id === 'krx')?.isOpen(new Date()) ?? false;
const valuesKey = (flow: InvestorFlow) => `${flow.foreignNet}|${flow.institutionNet}|${flow.individualNet}`;

// KIS 오류는 종류와 코드만 남긴다 (키·토큰이 들어갈 여지 없음)
function describeError(error: unknown) {
  if (error instanceof KisApiError) return `${error.message}${error.status ? ` status=${error.status}` : ''}${error.code ? ` code=${error.code}` : ''}`;
  return 'unexpected_error';
}

async function collectOnce(client: KisClient) {
  let failed = false;
  for (const market of FLOW_MARKETS) {
    const startedAt = Date.now();
    try {
      const result = await fetchInvestorFlow(client, market, startedAt);
      fetchDuration.observe({}, Date.now() - startedAt);
      if ('error' in result) {
        fetchTotal.inc({ market, result: 'invalid' });
        console.warn(`[flows] ${market} response not usable: ${result.error}`);
        failed = true;
        continue;
      }
      lastSuccessAt.set({ market }, Math.floor(Date.now() / 1000));

      const key = valuesKey(result);
      if (lastSent.get(market) === key) {
        fetchTotal.inc({ market, result: 'unchanged' });
        continue;
      }
      const producedAt = Date.now();
      await producer.send({
        topic: TOPICS.flows,
        messages: [{ key: market, value: JSON.stringify({ ...result, collectedAt: startedAt, producedAt }) }],
      });
      kafkaSendDuration.observe({}, Date.now() - producedAt);
      lastSent.set(market, key);
      fetchTotal.inc({ market, result: 'sent' });
    } catch (error) {
      fetchDuration.observe({}, Date.now() - startedAt);
      fetchTotal.inc({ market, result: 'error' });
      console.warn(`[flows] ${market} fetch failed: ${describeError(error)}`);
      failed = true;
    }
  }
  return !failed;
}

async function loop(client: KisClient) {
  if (stopping) return;
  let delay = IDLE_CHECK_INTERVAL_MS;
  if (krxOpen()) {
    const ok = await collectOnce(client);
    consecutiveFailures = ok ? 0 : consecutiveFailures + 1;
    // 실패가 이어지면 호출을 줄인다 (KIS 호출 제한 보호)
    delay = consecutiveFailures === 0 ? POLLING_INTERVAL_MS : Math.min(POLLING_INTERVAL_MS * 2 ** consecutiveFailures, MAX_BACKOFF_MS);
  }
  if (!stopping) timer = setTimeout(() => void loop(client), delay);
}

async function main() {
  console.log('Flows collector starting...');
  startMetricsServer(metricsConfig.port);
  startMetricsLog('flows-collector', metricsConfig.logIntervalMs);

  const config = readKisConfig();
  if (!config) {
    // 키가 없으면 KIS에 접속하지 않는다. 컨테이너는 대기 상태로 남는다 (재시작 반복 방지).
    configured.set({}, 0);
    console.warn('[flows] KIS credentials are not configured (KIS_APP_KEY / KIS_APP_SECRET). Investor flow collection is idle.');
    registerShutdown('flows-collector', []);
    return;
  }
  configured.set({}, 1);

  await producer.connect();
  await ensureTopics();
  console.log(`[flows] KIS ${config.env} configured. Polling every ${POLLING_INTERVAL_MS}ms during KRX hours.`);

  const client = new KisClient(config);
  registerShutdown('flows-collector', [
    { name: 'poll loop', run: () => { stopping = true; clearTimeout(timer); } },
    { name: 'kafka producer', run: () => producer.disconnect() },
  ]);
  void loop(client);
}

main().catch(error => {
  console.error(`Flows collector failed to start: ${error instanceof Error ? error.message : 'unexpected_error'}`);
  process.exit(1);
});
