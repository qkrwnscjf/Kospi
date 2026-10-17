import { Server, Socket } from 'socket.io';
import type { Consumer, EachMessagePayload } from 'kafkajs';
import { kafka, TOPICS, ensureTopics, sendToDlq } from '../../infrastructure/kafka.js';
import { Counter, Gauge, Latency } from '../../infrastructure/metrics.js';
import { marketService } from './market.service.js';
import { parseTick } from '../../shared/tick-validation.js';
import { isSubscribableSymbol } from '../../shared/symbols.js';
import type { TickData } from '../../shared/types.js';

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

// emit 순서 (docs/Task_ORDER.md T-23, BENCHMARK B-05)
const emitDelay = new Latency('kospi_gateway_emit_delay_seconds', 'Kafka consume to WebSocket emit inside the gateway');
const redisSkippedTotal = new Counter('kospi_gateway_redis_skipped_total', 'Latest tick not cached because Redis was not connected');

// 구독 요청 검증 (docs/security.md SEC-005)
const subscribeRejectedTotal = new Counter('kospi_gateway_subscribe_rejected_total', 'Rejected subscribe / unsubscribe requests by reason');

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

  // Broadcast to specific symbol room. 실시간 전송을 먼저 하고 Redis 저장은 기다리지 않는다 (T-23, BENCHMARK B-05).
  // 이전에는 Redis 저장을 기다린 뒤 emit해서, Redis가 끊기면 메시지마다 재시도를 기다리느라 실시간 경로 전체가 멈췄다.
  const emittedAt = Date.now();
  io.to(tick.symbol).emit('tick', tick);
  emitDelay.observe({}, emittedAt - consumedAt);

  if (tick.collectedAt !== undefined) {
    pipelineLatency.observe({ category: tick.category }, emittedAt - tick.collectedAt);
  }
  e2eLatency.observe({ category: tick.category }, emittedAt - tick.timestamp);
  messagesTotal.inc();

  void cacheLatestTick(tick);
};

// 최신 tick을 Redis에 저장한다. 예외를 던지지 않는다 (실패해도 실시간 전송에는 영향 없음).
async function cacheLatestTick(tick: TickData) {
  const startedAt = Date.now();
  try {
    const saved = await marketService.saveLatestTick(tick);
    if (saved) {
      redisSetDuration.observe({}, Date.now() - startedAt);
    } else {
      redisSkippedTotal.inc();
    }
  } catch (error) {
    redisErrorsTotal.inc();
    console.error(`Gateway failed to cache latest tick for ${tick.symbol}: ${errorMessage(error)}`);
  }
}

// 컨슈머 1개를 만들어 연결·구독·실행한다. 실패하면 인스턴스를 정리하고 에러를 던진다.
// 실패한 인스턴스를 재사용하지 않고 시도마다 새로 만든다 (상태가 꼬이는 것을 피하기 위함).
// 종료 처리(T-28)에서 끊을 수 있도록 현재 컨슈머를 기억한다.
let activeConsumer: Consumer | undefined;
let shuttingDown = false;

async function startConsumer(io: Server) {
  const consumer = kafka.consumer({ groupId: 'market-group' });
  activeConsumer = consumer;
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
      if (!event.payload.restart && !shuttingDown) {
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
  while (!shuttingDown) {
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
  connecting = false;
}

// 종료 처리 (docs/Task_ORDER.md T-28): 재연결을 멈추고, 컨슈머가 그룹에서 정상적으로 나가게 한다.
// 정상적으로 나가면 다시 시작할 때 Kafka가 이전 멤버의 세션 만료를 기다리지 않는다.
export async function stopMarketGateway() {
  shuttingDown = true;
  await activeConsumer?.disconnect().catch(error => console.error(`Gateway consumer disconnect failed: ${errorMessage(error)}`));
  await dlqProducer.disconnect().catch(error => console.error(`Gateway DLQ producer disconnect failed: ${errorMessage(error)}`));
  kafkaConnected.set({}, 0);
}

// WebSocket 핸들러는 Kafka 연결과 상관없이 먼저 등록한다 (docs/Task_ORDER.md T-14).
// Kafka가 없어도 브라우저는 접속해서 Redis에 캐시된 최신값을 받을 수 있다.
export const initMarketGateway = (io: Server) => {
  io.on('connection', (socket: Socket) => {
    console.log(`Client connected to gateway: ${socket.id}`);
    wsConnections.inc();

    // 구독 요청은 허용된 심볼 문자열만 받는다 (docs/security.md SEC-005).
    // 목록에 없는 값은 방을 만들지 않고, 로그에도 받은 값을 그대로 쓰지 않는다(로그 위조 방지).
    // 이미 참여한 방이면 다시 조회하지 않으므로, 연결 하나가 만드는 방과 Redis 조회는 심볼 수(16개)를 넘지 않는다.
    socket.on('subscribe_market', async (symbol: unknown) => {
      if (!isSubscribableSymbol(symbol)) {
        subscribeRejectedTotal.inc({ event: 'subscribe', reason: 'unknown_symbol' });
        return;
      }
      if (socket.rooms.has(symbol)) {
        subscribeRejectedTotal.inc({ event: 'subscribe', reason: 'already_joined' });
        return;
      }
      socket.join(symbol);
      console.log(`Client ${socket.id} subscribed to ${symbol}`);

      // Send the most recent cached tick immediately upon subscription
      try {
        const latestTick = await marketService.getLatestTick(symbol);
        if (latestTick) {
          socket.emit('tick', latestTick);
        }
      } catch (error) {
        redisErrorsTotal.inc();
        console.error(`Gateway failed to read latest tick for ${symbol}: ${errorMessage(error)}`);
      }
    });

    // 소켓 1개를 여러 차트가 함께 쓰므로(T-24), 화면에서 사라진 심볼은 구독을 해제한다.
    socket.on('unsubscribe_market', (symbol: unknown) => {
      if (!isSubscribableSymbol(symbol)) {
        subscribeRejectedTotal.inc({ event: 'unsubscribe', reason: 'unknown_symbol' });
        return;
      }
      socket.leave(symbol);
    });

    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.id}`);
      wsConnections.dec();
    });
  });

  void connectWithRetry(io);
};
