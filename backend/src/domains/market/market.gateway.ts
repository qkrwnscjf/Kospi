import { Server, Socket } from 'socket.io';
import { consumer } from '../../infrastructure/kafka.js';
import { Counter, Gauge, Latency } from '../../infrastructure/metrics.js';
import { marketService } from './market.service.js';
import type { TickData } from '../../shared/types.js';

// 측정 지표 (docs/Task_ORDER.md T-01)
const messagesTotal = new Counter('kospi_gateway_messages_total', 'Kafka messages processed by the gateway');
const kafkaLatency = new Latency('kospi_gateway_kafka_latency_seconds', 'Worker produce to gateway consume');
const redisSetDuration = new Latency('kospi_gateway_redis_set_duration_seconds', 'Redis latest tick SET duration');
const pipelineLatency = new Latency('kospi_gateway_pipeline_latency_seconds', 'Worker collection to WebSocket emit by category');
const e2eLatency = new Latency('kospi_gateway_e2e_latency_seconds', 'Source timestamp to WebSocket emit by category');
const wsConnections = new Gauge('kospi_ws_connections', 'Current WebSocket connections');
wsConnections.set({}, 0);

export const initMarketGateway = async (io: Server) => {
  try {
    // Setup Kafka Consumer
    await consumer.connect();
    await consumer.subscribe({ topic: 'market-ticks', fromBeginning: false });

    // Broadcast consumed messages to clients
    consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        if (!message.value) return;
        const consumedAt = Date.now();
        const tick: TickData = JSON.parse(message.value.toString());
        if (tick.producedAt !== undefined) {
          kafkaLatency.observe({}, consumedAt - tick.producedAt);
        }

        // Cache latest tick in Redis
        const redisStartedAt = Date.now();
        await marketService.saveLatestTick(tick);
        redisSetDuration.observe({}, Date.now() - redisStartedAt);

        // Broadcast to specific symbol room
        const emittedAt = Date.now();
        io.to(tick.symbol).emit('tick', tick);

        if (tick.collectedAt !== undefined) {
          pipelineLatency.observe({ category: tick.category }, emittedAt - tick.collectedAt);
        }
        e2eLatency.observe({ category: tick.category }, emittedAt - tick.timestamp);
        messagesTotal.inc();
      },
    });

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
  } catch (err) {
    console.error('Error initializing Market Gateway', err);
  }
};
