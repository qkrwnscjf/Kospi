import { fetchYahooData } from './yahoo-api.js';
import { fetchNaverData } from './naver-api.js';
import type { NormalizedMarketData } from './normalizer.js';
import { producer } from '../kafka.js';
import { Counter, Latency, metricsConfig, startMetricsLog, startMetricsServer } from '../metrics.js';

// 기본 10초. B-02 측정을 위해 환경변수로 바꿀 수 있게 했다 (docs/Task_ORDER.md T-30)
const POLLING_INTERVAL_MS = Number.parseInt(process.env.POLLING_INTERVAL_MS ?? '', 10) || 10000;

// 측정 지표 (docs/Task_ORDER.md T-01)
const fetchDuration = new Latency('kospi_worker_fetch_duration_seconds', 'External API fetch duration by source');
const fetchTotal = new Counter('kospi_worker_fetch_total', 'External API fetch attempts by source and result (success / empty)');
const itemsTotal = new Counter('kospi_worker_items_total', 'Items fetched by source');
const collectLag = new Latency('kospi_worker_collect_lag_seconds', 'Source timestamp to worker collection time by symbol');
const dbInsertDuration = new Latency('kospi_worker_db_insert_duration_seconds', 'TimescaleDB insert transaction duration');
const kafkaSendDuration = new Latency('kospi_worker_kafka_send_duration_seconds', 'Kafka producer send duration');
const cycleDuration = new Latency('kospi_worker_cycle_duration_seconds', 'One polling cycle duration (fetch + DB + Kafka)');

// 소스 갱신 주기 측정 (docs/Task_ORDER.md T-03, BENCHMARK M-04)
const sourceUpdateInterval = new Latency('kospi_worker_source_update_interval_seconds', 'Interval between consecutive new source timestamps by symbol');
const sourcePollTotal = new Counter('kospi_worker_source_poll_total', 'Polls by symbol and result (new_timestamp / same_timestamp)');
const lastSourceTimestamp = new Map<string, number>();

type CollectedMarketData = NormalizedMarketData & { collectedAt: number };

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

// 소스별 응답 시간과 수집 시각을 기록한다. 어댑터는 에러를 삼키고 []를 반환하므로 결과는 success / empty로만 구분된다.
async function collect(source: string, fetcher: () => Promise<NormalizedMarketData[]>): Promise<CollectedMarketData[]> {
  const startedAt = Date.now();
  const items = await fetcher();
  const collectedAt = Date.now();

  fetchDuration.observe({ source }, collectedAt - startedAt);
  fetchTotal.inc({ source, result: items.length > 0 ? 'success' : 'empty' });
  itemsTotal.inc({ source }, items.length);

  return items.map(item => {
    collectLag.observe({ symbol: item.ticker }, collectedAt - item.timestamp);
    if (source === 'yahoo') {
      trackSourceUpdate(item);
    }
    return { ...item, collectedAt };
  });
}

async function runIngestionWorker() {
  console.log('🚀 Data Ingestion Worker Started...');
  console.log(`Polling interval: ${POLLING_INTERVAL_MS}ms`);

  await producer.connect();
  console.log('Connected to Kafka producer.');

  // Kafka 연결 성공 후에 시작한다. 연결 실패 시 메트릭 서버 때문에 프로세스가 살아남지 않도록.
  startMetricsServer(metricsConfig.port);
  startMetricsLog('worker', metricsConfig.logIntervalMs);
  console.log(`Metrics server listening on :${metricsConfig.port} (internal only)`);

  setInterval(async () => {
    const cycleStartedAt = Date.now();
    try {
      console.log(`\n[${new Date().toISOString()}] Fetching market data...`);

      const [yahooData, naverData] = await Promise.all([
        collect('yahoo', fetchYahooData),
        collect('naver', fetchNaverData)
      ]);

      const allData = [...yahooData, ...naverData];

      if (allData.length > 0) {
        console.log(`Successfully fetched ${allData.length} items. Sending to Kafka and DB...`);

        // --- 1. DB 적재 (TimescaleDB) ---
        const { dbPool } = await import('../db.js');
        const dbStartedAt = Date.now();
        const client = await dbPool.connect();
        try {
          await client.query('BEGIN');
          for (const data of allData) {
            await client.query(
              `INSERT INTO market_ticks (time, symbol, category, price, change_rate, change_price, volume)
               VALUES (to_timestamp($1 / 1000.0), $2, $3, $4, $5, $6, $7)`,
              [
                data.timestamp || Date.now(),
                data.ticker,
                data.category,
                data.price,
                data.changeRate,
                data.changePrice,
                data.volume || null
              ]
            );
          }
          await client.query('COMMIT');
          dbInsertDuration.observe({ result: 'commit' }, Date.now() - dbStartedAt);
        } catch (dbErr) {
          await client.query('ROLLBACK');
          dbInsertDuration.observe({ result: 'rollback' }, Date.now() - dbStartedAt);
          console.error('Failed to insert into TimescaleDB:', dbErr);
        } finally {
          client.release();
        }

        // --- 2. Kafka 전송 ---
        const producedAt = Date.now();
        const messages = allData.map(data => {
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
            producedAt
          };

          return {
            key: data.ticker,
            value: JSON.stringify(tickData)
          };
        });

        await producer.send({ topic: 'market-ticks', messages });
        kafkaSendDuration.observe({}, Date.now() - producedAt);

        // 콘솔 출력 테스트 (상위 3개만)
        console.log('Sample Data Sent:', allData.slice(0, 3).map(d => d.ticker));
      }

      cycleDuration.observe({}, Date.now() - cycleStartedAt);
    } catch (error) {
      console.error('Worker loop error:', error);
    }
  }, POLLING_INTERVAL_MS);
}

runIngestionWorker().catch(console.error);
