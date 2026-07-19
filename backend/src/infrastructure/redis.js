import Redis from 'ioredis';
import 'dotenv/config';
export const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
//# sourceMappingURL=redis.js.map