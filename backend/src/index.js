import 'dotenv/config';
import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifySocketIO from 'fastify-socket.io';
import { initMarketGateway } from './domains/market/market.gateway.js';
import { historyController } from './domains/history/history.controller.js';
import { initDB } from './infrastructure/db.js';
const fastify = Fastify({ logger: true });
// Register CORS
fastify.register(fastifyCors, {
    origin: '*', // Adjust for production
});
// Register Socket.io plugin
fastify.register(fastifySocketIO, {
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
fastify.ready(async (err) => {
    if (err)
        throw err;
    // Initialize WebSocket gateways
    await initMarketGateway(fastify.io);
    fastify.log.info('Market WebSocket Gateway initialized.');
    // Start background worker for generating dummy tick data -> Kafka
    // startIngestionWorker().catch(fastify.log.error);
});
const start = async () => {
    try {
        await initDB();
        const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
        await fastify.listen({ port, host: '0.0.0.0' });
        fastify.log.info(`Server is now listening on http://localhost:${port}`);
    }
    catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};
start();
//# sourceMappingURL=index.js.map