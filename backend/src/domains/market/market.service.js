import { redis } from '../../infrastructure/redis.js';
export class MarketService {
    async saveLatestTick(tick) {
        // Cache the latest tick data using symbol as part of the key
        await redis.set(`latest_tick:${tick.symbol}`, JSON.stringify(tick));
    }
    async getLatestTick(symbol) {
        const data = await redis.get(`latest_tick:${symbol}`);
        return data ? JSON.parse(data) : null;
    }
}
export const marketService = new MarketService();
//# sourceMappingURL=market.service.js.map