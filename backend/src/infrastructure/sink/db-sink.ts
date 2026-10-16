import { kafka, TOPICS, ensureTopics, sendToDlq } from '../kafka.js';
import { dbPool } from '../db.js';
import { Counter, Latency, metricsConfig, startMetricsLog, startMetricsServer } from '../metrics.js';
import { parseTick } from '../../shared/tick-validation.js';
import type { TickData } from '../../shared/types.js';

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

// 여러 행을 INSERT 한 번으로 저장한다 (P-16). 단일 문장이라 전부 들어가거나 전부 실패한다.
async function insertBatch(ticks: TickData[]) {
  const values: unknown[] = [];
  const rows = ticks.map((tick, index) => {
    const base = index * 7;
    values.push(tick.timestamp, tick.symbol, tick.category, tick.price, tick.changeRate, tick.changePrice, tick.volume ?? null);
    return `(to_timestamp($${base + 1} / 1000.0), $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
  });
  await dbPool.query(
    `INSERT INTO market_ticks (time, symbol, category, price, change_rate, change_price, volume) VALUES ${rows.join(', ')}`,
    values
  );
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
        try {
          await insertBatch(valid);
        } catch (error) {
          insertDuration.observe({ result: 'error' }, Date.now() - startedAt);
          // 예외를 던져서 오프셋을 커밋하지 않는다. kafkajs가 같은 묶음을 다시 시도한다 (데이터가 유효하므로 poison이 아님).
          console.error(`DB sink insert failed (${valid.length} rows): ${error instanceof Error ? error.message : String(error)}`);
          throw error;
        }
        const committedAt = Date.now();
        insertDuration.observe({ result: 'commit' }, committedAt - startedAt);
        batchesTotal.inc();
        rowsInsertedTotal.inc({}, valid.length);
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
}

// 시작에 실패하면 종료 코드 1로 끝내서 docker-compose가 다시 띄우게 한다 (T-08과 같은 방식).
run().catch(error => {
  console.error('DB sink failed to start:', error);
  process.exit(1);
});
