import { kafka, TOPICS, ensureTopics, sendToDlq } from '../kafka.js';
import { dbPool } from '../db.js';
import { Counter, Gauge, Latency, metricsConfig, startMetricsLog, startMetricsServer } from '../metrics.js';
import { parseTick } from '../../shared/tick-validation.js';
import type { TickData } from '../../shared/types.js';
import { runBackfillOnce } from './backfill.js';
import { registerShutdown } from '../shutdown.js';

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
const dbChunks = new Gauge('kospi_db_chunks', 'Number of chunks of the raw hypertable and each continuous aggregate (T-31)');
// 보관·갱신 작업 상태 (docs/Task_ORDER.md T-48). 원본이 3시간보다 오래 남는 원인을 확인하기 위함 (B-21 관찰)
const dbJobSchedule = new Gauge('kospi_db_job_schedule_seconds', 'Schedule interval of TimescaleDB retention / refresh jobs');
const dbJobLastSuccessAge = new Gauge('kospi_db_job_last_success_age_seconds', 'Seconds since the last successful run of each TimescaleDB job');
const dbJobFailures = new Gauge('kospi_db_job_failures', 'Total failures of each TimescaleDB job');
const dbRawOldestAge = new Gauge('kospi_db_raw_oldest_age_seconds', 'Age of the oldest row in market_ticks (raw retention target: 3h, D-02)');
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

// 원본과 집계의 용량, 청크 수, 보관·갱신 작업 상태를 기록한다 (B-07, T-31, T-48). 조회 실패는 수집에 영향을 주지 않도록 로그만 남긴다.
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

    const chunks = await dbPool.query<{ relation: string; chunks: string }>(`
      SELECT 'market_ticks' AS relation, count(*)::text AS chunks
      FROM timescaledb_information.chunks WHERE hypertable_name = 'market_ticks'
      UNION ALL
      SELECT ca.view_name::text AS relation, count(c.chunk_name)::text AS chunks
      FROM timescaledb_information.continuous_aggregates ca
      LEFT JOIN timescaledb_information.chunks c
        ON c.hypertable_schema = ca.materialization_hypertable_schema
       AND c.hypertable_name = ca.materialization_hypertable_name
      GROUP BY ca.view_name
    `);
    for (const row of chunks.rows) {
      dbChunks.set({ relation: row.relation }, Number(row.chunks));
    }

    // 보관(retention)과 집계 갱신(refresh) 작업 (T-48). 집계 작업은 저장 테이블 대신 집계 이름으로 표시한다.
    const jobs = await dbPool.query<{ job: string; schedule_s: number; last_success_age_s: number | null; failures: number | null }>(`
      SELECT replace(j.proc_name, 'policy_', '') || ':' || COALESCE(ca.view_name::text, j.hypertable_name::text) AS job,
             extract(epoch FROM j.schedule_interval)::float8 AS schedule_s,
             extract(epoch FROM now() - s.last_successful_finish)::float8 AS last_success_age_s,
             s.total_failures::float8 AS failures
      FROM timescaledb_information.jobs j
      LEFT JOIN timescaledb_information.job_stats s ON s.job_id = j.job_id
      LEFT JOIN timescaledb_information.continuous_aggregates ca
        ON ca.materialization_hypertable_schema = j.hypertable_schema
       AND ca.materialization_hypertable_name = j.hypertable_name
      WHERE j.proc_name IN ('policy_retention', 'policy_refresh_continuous_aggregate')
    `);
    for (const row of jobs.rows) {
      dbJobSchedule.set({ job: row.job }, row.schedule_s);
      if (row.last_success_age_s !== null) dbJobLastSuccessAge.set({ job: row.job }, Math.round(row.last_success_age_s));
      if (row.failures !== null) dbJobFailures.set({ job: row.job }, row.failures);
    }

    const oldest = await dbPool.query<{ age_s: number | null }>(
      `SELECT extract(epoch FROM now() - min(time))::float8 AS age_s FROM market_ticks`
    );
    // 원본이 비어 있으면 0으로 기록한다 (값을 건너뛰면 이전 값이 남아 오래된 것처럼 보임).
    // 주의: worker가 다시 시작하면 지표마다 마지막 tick을 한 번 다시 보낸다. 장이 닫힌 시간에는 그 시각이 오래전이라
    // 다음 보관 작업(1시간 주기)까지 이 값이 커질 수 있다 (B-22).
    dbRawOldestAge.set({}, Math.round(oldest.rows[0]?.age_s ?? 0));
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

  // 종료 처리 (docs/Task_ORDER.md T-28): 컨슈머를 먼저 끊는다. kafkajs는 처리 중인 묶음이 끝날 때까지 기다린 뒤 그룹에서 나간다.
  // 커밋하지 못한 묶음은 다음 기동에서 다시 처리되고, 중복은 유니크 제약이 건너뛴다(at-least-once).
  registerShutdown('db-sink', [
    { name: 'kafka consumer', run: () => consumer.disconnect() },
    { name: 'dlq producer', run: () => dlqProducer.disconnect() },
    { name: 'db pool', run: () => dbPool.end() },
  ]);
}

// 시작에 실패하면 종료 코드 1로 끝내서 docker-compose가 다시 띄우게 한다 (T-08과 같은 방식).
run().catch(error => {
  console.error('DB sink failed to start:', error);
  process.exit(1);
});
