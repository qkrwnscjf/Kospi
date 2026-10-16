import { Server, Socket } from 'socket.io';
import type { EachMessagePayload } from 'kafkajs';
import { kafka, TOPICS, ensureTopics, sendToDlq } from '../../infrastructure/kafka.js';
import { Counter, Gauge, Latency } from '../../infrastructure/metrics.js';
import { marketService } from './market.service.js';
import { parseTick } from '../../shared/tick-validation.js';

// 측정 지표 (docs/Task_ORDER.md T-01)
const messagesTotal = new Counter('kospi_gateway_messages_total', 'Kafka messages processed by the gateway');
const kafkaLatency = new Latency('kospi_gateway_kafka_latency_seconds', 'Worker produce to gateway consume');
const redisSetDuration = new Latency('kospi_gateway_redis_set_duration_seconds', 'Redis latest tick SET duration');
const pipelineLatency = new Latency('kospi_gateway_pipeline_latency_seconds', 'Worker collection to WebSocket emit by category');
const e2eLatency = new Latency('kospi_gateway_e2e_latency_seconds', 'Source timestamp to WebSocket emit by category');
const wsConnections = new Gauge('kospi_ws_connections', 'Current WebSocket connections');
wsConnections.set({}, 0);

// Kafka 연결 상태 (docs/Task_ORDER.md T-14)
const kafkaConnected = new Gauge('kospi_gateway_kafka_connected', 'Whether the gateway Kafka consumer is connected (1) or not (0)');
const kafkaConnectAttempts = new Counter('kospi_gateway_kafka_connect_attempts_total', 'Gateway Kafka connect attempts by result (success / failure)');
kafkaConnected.set({}, 0);

// 잘못된 메시지 방어 (docs/Task_ORDER.md T-13, SEC-002)
const invalidTotal = new Counter('kospi_gateway_invalid_messages_total', 'Messages sent to the DLQ by the gateway, by reason');
const redisErrorsTotal = new Counter('kospi_gateway_redis_errors_total', 'Redis errors while caching the latest tick');

const RECONNECT_INITIAL_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
const CONSUMER_NAME = 'gateway';

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const dlqProducer = kafka.producer();

// 이 핸들러는 예외를 던지지 않는다. 던지면 kafkajs가 같은 메시지를 계속 다시 시도해서 실시간 경로 전체가 멈춘다 (SEC-002).
const handleMessage = (io: Server) => async ({ topic, partition, message }: EachMessagePayload) => {
  const consumedAt = Date.now();
  const parsed = parseTick(message.value);
  if (!parsed.ok) {
    invalidTotal.inc({ reason: parsed.reason });
    console.warn(`Gateway skipped invalid message at ${topic}[${partition}]@${message.offset}: ${parsed.reason}`);
    await sendToDlq(dlqProducer, { consumer: CONSUMER_NAME, topic, partition, message, reason: parsed.reason });
    return;
  }

  const tick = parsed.tick;
  if (tick.producedAt !== undefined) {
    kafkaLatency.observe({}, consumedAt - tick.producedAt);
  }

  // Cache latest tick in Redis. 실패해도 브라우저 전송은 계속한다.
  const redisStartedAt = Date.now();
  try {
    await marketService.saveLatestTick(tick);
    redisSetDuration.observe({}, Date.now() - redisStartedAt);
  } catch (error) {
    redisErrorsTotal.inc();
    console.error(`Gateway failed to cache latest tick for ${tick.symbol}: ${errorMessage(error)}`);
  }

  // Broadcast to specific symbol room
  const emittedAt = Date.now();
  io.to(tick.symbol).emit('tick', tick);

  if (tick.collectedAt !== undefined) {
    pipelineLatency.observe({ category: tick.category }, emittedAt - tick.collectedAt);
  }
  e2eLatency.observe({ category: tick.category }, emittedAt - tick.timestamp);
  messagesTotal.inc();
};

// 컨슈머 1개를 만들어 연결·구독·실행한다. 실패하면 인스턴스를 정리하고 에러를 던진다.
// 실패한 인스턴스를 재사용하지 않고 시도마다 새로 만든다 (상태가 꼬이는 것을 피하기 위함).
async function startConsumer(io: Server) {
  const consumer = kafka.consumer({ groupId: 'market-group' });
  try {
    await dlqProducer.connect();
    await ensureTopics();
    await consumer.connect();
    await consumer.subscribe({ topic: TOPICS.ticks, fromBeginning: false });

    consumer.on(consumer.events.GROUP_JOIN, () => kafkaConnected.set({}, 1));
    consumer.on(consumer.events.CRASH, event => {
      kafkaConnected.set({}, 0);
      console.error(`Gateway Kafka consumer crashed: ${errorMessage(event.payload.error)} (restart: ${event.payload.restart})`);
      // kafkajs가 스스로 재시작하지 않는 중단이면 재연결 루프로 다시 연결한다.
      if (!event.payload.restart) {
        consumer.disconnect().catch(() => undefined);
        void connectWithRetry(io);
      }
    });

    await consumer.run({ eachMessage: handleMessage(io) });
    kafkaConnectAttempts.inc({ result: 'success' });
    kafkaConnected.set({}, 1);
    console.log('Gateway Kafka consumer connected.');
  } catch (error) {
    kafkaConnectAttempts.inc({ result: 'failure' });
    await consumer.disconnect().catch(() => undefined);
    throw error;
  }
}

// 연결에 성공할 때까지 백그라운드에서 재시도한다 (1초부터 2배씩, 최대 30초).
// 이전에는 한 번 실패하면 다시 시도하지 않아서, backend를 재시작해야 실시간 경로가 복구되었다 (P-04).
let connecting = false;
async function connectWithRetry(io: Server) {
  if (connecting) return;
  connecting = true;

  let delay = RECONNECT_INITIAL_DELAY_MS;
  while (true) {
    try {
      await startConsumer(io);
      connecting = false;
      return;
    } catch (error) {
      console.error(`Gateway Kafka connect failed: ${errorMessage(error)}. Retrying in ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, RECONNECT_MAX_DELAY_MS);
    }
  }
}

// WebSocket 핸들러는 Kafka 연결과 상관없이 먼저 등록한다 (docs/Task_ORDER.md T-14).
// Kafka가 없어도 브라우저는 접속해서 Redis에 캐시된 최신값을 받을 수 있다.
export const initMarketGateway = (io: Server) => {
  io.on('connection', (socket: Socket) => {
    console.log(`Client connected to gateway: ${socket.id}`);
    wsConnections.inc();

    socket.on('subscribe_market', async (symbol: string) => {
      socket.join(symbol);
      console.log(`Client ${socket.id} subscribed to ${symbol}`);

      // Send the most recent cached tick immediately upon subscription
      const latestTick = await marketService.getLatestTick(symbol);
      if (latestTick) {
        socket.emit('tick', latestTick);
      }
    });

    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.id}`);
      wsConnections.dec();
    });
  });

  void connectWithRetry(io);
};
