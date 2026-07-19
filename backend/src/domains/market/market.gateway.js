import { Server, Socket } from 'socket.io';
import { consumer } from '../../infrastructure/kafka.js';
import { marketService } from './market.service.js';
export const initMarketGateway = async (io) => {
    try {
        // Setup Kafka Consumer
        await consumer.connect();
        await consumer.subscribe({ topic: 'market-ticks', fromBeginning: false });
        // Broadcast consumed messages to clients
        consumer.run({
            eachMessage: async ({ topic, partition, message }) => {
                if (!message.value)
                    return;
                const tick = JSON.parse(message.value.toString());
                // Cache latest tick in Redis
                await marketService.saveLatestTick(tick);
                // Broadcast to specific symbol room
                io.to(tick.symbol).emit('tick', tick);
            },
        });
        io.on('connection', (socket) => {
            console.log(`Client connected to gateway: ${socket.id}`);
            socket.on('subscribe_market', async (symbol) => {
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
            });
        });
    }
    catch (err) {
        console.error('Error initializing Market Gateway', err);
    }
};
//# sourceMappingURL=market.gateway.js.map