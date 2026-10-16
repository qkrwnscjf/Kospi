import 'dotenv/config';
import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifySocketIO from 'fastify-socket.io';
import { initMarketGateway } from './domains/market/market.gateway.js';
import { historyController, startHistorySelfCheck } from './domains/history/history.controller.js';
import { initDB } from './infrastructure/db.js';
import { metricsConfig, startMetricsLog, startMetricsServer } from './infrastructure/metrics.js';

const fastify = Fastify({ logger: true });

// Register CORS
fastify.register(fastifyCors, {
  origin: '*', // Adjust for production
});

// Register Socket.io plugin
fastify.register(fastifySocketIO as any, {
  cors: {
    origin: '*',
  }
});

// Register REST Controllers
fastify.register(historyController);

// Health check
fastify.get('/api/health', async (request, reply) => {
  return { status: 'ok', message: 'Kospi Dashboard API is running.' };
});

fastify.ready(async err => {
  if (err) throw err;

  // Initialize WebSocket gateways
  // 핸들러만 바로 등록하고, Kafka 연결은 백그라운드에서 성공할 때까지 재시도한다 (docs/Task_ORDER.md T-14).
  // 연결 성공 여부는 'Gateway Kafka consumer connected.' 로그와 kospi_gateway_kafka_connected 메트릭으로 확인한다.
  initMarketGateway((fastify as any).io);
  fastify.log.info('Market WebSocket handlers registered (Kafka consumer connects in background).');

  // Start background worker for generating dummy tick data -> Kafka
  // startIngestionWorker().catch(fastify.log.error);
});

const start = async () => {
  try {
    await initDB();
    const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
    await fastify.listen({ port, host: '0.0.0.0' });
    fastify.log.info(`Server is now listening on http://localhost:${port}`);

    // 메트릭은 공개 API 포트가 아닌 내부 전용 포트로 노출한다 (docs/Task_ORDER.md T-01)
    startMetricsServer(metricsConfig.port);
    startMetricsLog('backend', metricsConfig.logIntervalMs);
    fastify.log.info(`Metrics server listening on :${metricsConfig.port} (internal only)`);
    startHistorySelfCheck();
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
