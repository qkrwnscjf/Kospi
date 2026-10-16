import { kafka, TOPICS, ensureTopics, sendToDlq } from '../kafka.js';
import { dbPool } from '../db.js';
import { Counter, Gauge, Latency, metricsConfig, startMetricsLog, startMetricsServer } from '../metrics.js';
import { parseTick } from '../../shared/tick-validation.js';
import type { TickData } from '../../shared/types.js';
import { runBackfillOnce } from './backfill.js';

// DB 적재 컨슈머 (docs/Task_ORDER.md T-12, D-18)
// worker 대신 Kafka의 market-ticks를 읽어 TimescaleDB에 저장한다. Kafka가 단일 출처가 된다.
// 저장에 성공한 뒤에만 오프셋을 커밋하므로, DB가 멈춰도 데이터를 잃지 않는다 (at-least-once).

const GROUP_ID = 'db-sink';
const CONSUMER_NAME = 'db-sink';

const consumer = kafka.consumer({ groupId: GROUP_ID });
const dlqProducer = kafka.producer();

// 측정 지표
const rowsInsertedTotal = new Counter('kospi_sink_rows_inserted_total', 'Rows inserted into TimescaleDB by the DB sink');
const invalidTotal = new Counter('kospi_sink_invalid_messages_total', 'Messages sent to the DLQ by the DB sink, by reason');
const insertDuration = new Latency('kospi_sink_insert_duration_seconds', 'Batch INSERT duration by result (commit / error)');
const batchesTotal = new Counter('kospi_sink_batches_total', 'Batch INSERTs committed (average batch size = rows_inserted_total / batches_total)');
const storeLatency = new Latency('kospi_sink_store_latency_seconds', 'Worker collection to DB commit (M-03 equivalent for the storage path)');
// 중복 차단 (docs/Task_ORDER.md T-15): 같은 (symbol, time)이 이미 있으면 DB가 건너뛴다
const duplicatesSkippedTotal = new Counter('kospi_sink_duplicates_skipped_total', 'Rows skipped by ON CONFLICT (symbol, time) DO NOTHING');
// DB 용량 (BENCHMARK B-07)
const dbSizeBytes = new Gauge('kospi_db_size_bytes', 'Size of the raw hypertable and each continuous aggregate in bytes');
const DB_SIZE_INTERVAL_MS = 5 * 60 * 1000;

// 여러 행을 INSERT 한 번으로 저장한다 (P-16). 단일 문장이라 전부 들어가거나 전부 실패한다.
// 실제로 들어간 행 수를 돌려준다. 나머지는 유니크 제약에 걸려 건너뛴 중복이다 (T-15).
async function insertBatch(ticks: TickData[]) {
  const values: unknown[] = [];
  const rows = ticks.map((tick, index) => {
    const base = index * 7;
    values.push(tick.timestamp, tick.symbol, tick.category, tick.price, tick.changeRate, tick.changePrice, tick.volume ?? null);
    return `(to_timestamp($${base + 1} / 1000.0), $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
  });
  const result = await dbPool.query(
    `INSERT INTO market_ticks (time, symbol, category, price, change_rate, change_price, volume) VALUES ${rows.join(', ')}
     ON CONFLICT (symbol, time) DO NOTHING`,
    values
  );
  return result.rowCount ?? 0;
}

// 원본과 집계의 용량을 기록한다 (B-07). 조회 실패는 수집에 영향을 주지 않도록 로그만 남긴다.
async function recordDbSize() {
  try {
    const { rows } = await dbPool.query<{ relation: string; bytes: string }>(`
      SELECT 'market_ticks' AS relation, hypertable_size('market_ticks')::text AS bytes
      UNION ALL
      SELECT view_name::text AS relation,
             hypertable_size(format('%I.%I', materialization_hypertable_schema, materialization_hypertable_name)::regclass)::text AS bytes
      FROM timescaledb_information.continuous_aggregates
    `);
    for (const row of rows) {
      dbSizeBytes.set({ relation: row.relation }, Number(row.bytes));
    }
  } catch (error) {
    console.error(`DB size check failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function run() {
  console.log('DB sink starting...');
  await dlqProducer.connect();
  await ensureTopics();
  await consumer.connect();
  // 그룹이 처음 시작할 때만 토픽의 처음부터 읽는다. 이후에는 커밋된 오프셋부터 이어서 읽는다.
  await consumer.subscribe({ topic: TOPICS.ticks, fromBeginning: true });

  // kafkajs가 스스로 재시작하지 않는 중단이면 종료해서 docker-compose의 restart: on-failure가 다시 띄우게 한다.
  consumer.on(consumer.events.CRASH, event => {
    console.error(`DB sink consumer crashed: ${event.payload.error.message} (restart: ${event.payload.restart})`);
    if (!event.payload.restart) process.exit(1);
  });

  startMetricsServer(metricsConfig.port);
  startMetricsLog('db-sink', metricsConfig.logIntervalMs);

  await consumer.run({
    eachBatchAutoResolve: false,
    eachBatch: async ({ batch, resolveOffset, heartbeat }) => {
      const valid: TickData[] = [];

      for (const message of batch.messages) {
        const parsed = parseTick(message.value);
        // change_price 컬럼은 NOT NULL이라, 없으면 묶음 전체가 계속 실패한다. 그래서 DLQ로 보낸다.
        const reason = !parsed.ok ? parsed.reason : parsed.tick.changePrice === undefined ? 'change_price_missing' : undefined;
        if (reason || !parsed.ok) {
          invalidTotal.inc({ reason: reason ?? 'unknown' });
          console.warn(`DB sink skipped invalid message at ${batch.topic}[${batch.partition}]@${message.offset}: ${reason}`);
          await sendToDlq(dlqProducer, { consumer: CONSUMER_NAME, topic: batch.topic, partition: batch.partition, message, reason: reason ?? 'unknown' });
          continue;
        }
        valid.push(parsed.tick);
      }

      if (valid.length > 0) {
        const startedAt = Date.now();
        let inserted: number;
        try {
          inserted = await insertBatch(valid);
        } catch (error) {
          insertDuration.observe({ result: 'error' }, Date.now() - startedAt);
          // 예외를 던져서 오프셋을 커밋하지 않는다. kafkajs가 같은 묶음을 다시 시도한다 (데이터가 유효하므로 poison이 아님).
          console.error(`DB sink insert failed (${valid.length} rows): ${error instanceof Error ? error.message : String(error)}`);
          throw error;
        }
        const committedAt = Date.now();
        insertDuration.observe({ result: 'commit' }, committedAt - startedAt);
        batchesTotal.inc();
        rowsInsertedTotal.inc({}, inserted);
        if (inserted < valid.length) {
          duplicatesSkippedTotal.inc({}, valid.length - inserted);
        }
        for (const tick of valid) {
          if (tick.collectedAt !== undefined) {
            storeLatency.observe({}, committedAt - tick.collectedAt);
          }
        }
      }

      const lastMessage = batch.messages[batch.messages.length - 1];
      if (lastMessage) {
        resolveOffset(lastMessage.offset);
      }
      await heartbeat();
    },
  });

  console.log('DB sink consumer started.');

  // 최초 1회 과거 데이터 채우기 (T-19). 실시간 적재와 동시에 진행하고, 실패해도 적재는 계속한다 (다음 기동에서 다시 시도).
  runBackfillOnce()
    .catch(error => console.error(`Backfill failed: ${error instanceof Error ? error.message : String(error)}`))
    .finally(() => void recordDbSize());

  setInterval(() => void recordDbSize(), DB_SIZE_INTERVAL_MS);
}

// 시작에 실패하면 종료 코드 1로 끝내서 docker-compose가 다시 띄우게 한다 (T-08과 같은 방식).
run().catch(error => {
  console.error('DB sink failed to start:', error);
  process.exit(1);
});
