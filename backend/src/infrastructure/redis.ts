import Redis from 'ioredis';
import 'dotenv/config';

export const redis = new (Redis as any)(process.env.REDIS_URL || 'redis://localhost:6379');
