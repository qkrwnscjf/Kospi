import type { FastifyInstance } from 'fastify';
import YahooFinance from 'yahoo-finance2';
import { redis } from '../../infrastructure/redis.js';
import { Latency } from '../../infrastructure/metrics.js';

const yahooFinance = new YahooFinance();

// 측정 지표 (docs/Task_ORDER.md T-01, BENCHMARK M-11)
const historyDuration = new Latency('kospi_history_request_duration_seconds', 'History API response time by result (cache_hit / cache_miss / mock / error)');

const YAHOO_SYMBOLS: Record<string, string> = {
  KOSPI: '^KS11',
  KOSDAQ: '^KQ11',
  'USD/KRW': 'KRW=X',
  DXY: 'DX-Y.NYB',
  'US10Y': '^TNX',
  SP500: '^GSPC',
  NASDAQ: '^NDX',
  SOX: '^SOX',
  WTI: 'CL=F',
  COPPER: 'HG=F'
};

export const historyController = async (fastify: FastifyInstance) => {
  fastify.get('/api/v1/market/history', async (request, reply) => {
    const startedAt = Date.now();
    const { ticker, timeframe } = request.query as { ticker: string, timeframe: string };
    const yahooSymbol = YAHOO_SYMBOLS[ticker];

    // If we don't have a yahoo symbol, fallback to dummy data
    if (!yahooSymbol) {
      let points = 30;
      let base = 2500;
      let volatility = 50;
      let intervalMs = 60000; 
      
      if (ticker === 'KOSDAQ') base = 850;
      if (ticker === 'USD/KRW') base = 1370;
      if (ticker === 'SP500') base = 5200;

      const now = Date.now();

      if (timeframe === '1일') { points = 60; intervalMs = 1000 * 60 * 5; volatility = 20; } 
      else if (timeframe === '1주') { points = 35; intervalMs = 1000 * 60 * 60 * 4; volatility = 60; } 
      else if (timeframe === '1개월') { points = 30; intervalMs = 1000 * 60 * 60 * 24; volatility = 100; } 
      else if (timeframe === '3개월') { points = 90; intervalMs = 1000 * 60 * 60 * 24; volatility = 150; } 
      else if (timeframe === '1년') { points = 52; intervalMs = 1000 * 60 * 60 * 24 * 7; volatility = 300; } 

      const data = Array.from({ length: points }, (_, i) => {
        const time = now - ((points - i - 1) * intervalMs);
        const value = base + Math.sin(i * 0.5) * volatility + (Math.random() - 0.5) * volatility * 0.5;
        return { time, value: parseFloat(value.toFixed(2)) };
      });

      historyDuration.observe({ result: 'mock' }, Date.now() - startedAt);
      return { ticker, timeframe, data };
    }

    // Real historical data fetching with Redis Caching
    try {
      const cacheKey = `history:${yahooSymbol}:${timeframe}`;
      const cached = await redis.get(cacheKey);
      
      if (cached) {
        historyDuration.observe({ result: 'cache_hit' }, Date.now() - startedAt);
        return JSON.parse(cached);
      }

      const now = new Date();
      let period1 = new Date();
      let interval = '1d';

      if (timeframe === '1일') { period1.setDate(now.getDate() - 2); interval = '15m'; }
      else if (timeframe === '1주') { period1.setDate(now.getDate() - 7); }
      else if (timeframe === '1개월') { period1.setMonth(now.getMonth() - 1); }
      else if (timeframe === '3개월') { period1.setMonth(now.getMonth() - 3); }
      else if (timeframe === '1년') { period1.setFullYear(now.getFullYear() - 1); interval = '1wk'; }

      const queryOptions = {
        period1,
        interval: interval as "1d" | "1m" | "2m" | "5m" | "15m" | "30m" | "60m" | "90m" | "1h" | "5d" | "1wk" | "1mo" | "3mo"
      };

      const results = await yahooFinance.chart(yahooSymbol, queryOptions);

      const data = results.quotes.map((row: any) => ({
        time: row.date.getTime(),
        value: parseFloat((row.close || 0).toFixed(2))
      }));

      const responsePayload = { ticker, timeframe, data };
      
      // Cache the result for 5 minutes (300 seconds)
      await redis.set(cacheKey, JSON.stringify(responsePayload), 'EX', 300);

      historyDuration.observe({ result: 'cache_miss' }, Date.now() - startedAt);
      return responsePayload;
    } catch (err) {
      historyDuration.observe({ result: 'error' }, Date.now() - startedAt);
      console.error(`Error fetching historical data for ${ticker}:`, err);
      return reply.code(500).send({ error: 'Failed to fetch historical data' });
    }
  });
};
