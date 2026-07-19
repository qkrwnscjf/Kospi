import { redis } from '../../infrastructure/redis.js';
import type { TickData } from '../../shared/types.js';

export class MarketService {
  async saveLatestTick(tick: TickData) {
    // Cache the latest tick data using symbol as part of the key
    await redis.set(`latest_tick:${tick.symbol}`, JSON.stringify(tick));
  }

  async getLatestTick(symbol: string): Promise<TickData | null> {
    const data = await redis.get(`latest_tick:${symbol}`);
    return data ? JSON.parse(data) : null;
  }
}

export const marketService = new MarketService();
