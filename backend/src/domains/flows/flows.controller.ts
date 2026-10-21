import type { FastifyInstance } from 'fastify';
import { redis } from '../../infrastructure/redis.js';
import { dbPool } from '../../infrastructure/db.js';
import { Latency } from '../../infrastructure/metrics.js';
import { isFlowMarket, type FlowMarket } from '../../shared/flows.js';

// 증시 자금 흐름 조회 API (docs/Task_ORDER.md 11단계 A, T-63)
// GET /api/v1/flows/investors?market=KOSPI&range=1일
// - 1일: 가장 최근 거래일의 장중 추이(잠정치, 분 단위)
// - 1주 ~ 1년: 거래일별 마지막 값(확정치가 있으면 확정치)
// 시장·기간은 고정된 표에서만 고르고, 값은 매개변수로만 SQL에 넘긴다.

const flowsDuration = new Latency('kospi_flows_request_duration_seconds', 'Investor flows API response time by result');

const DAILY_RANGES: Record<string, string> = {
  '1주': '7 days',
  '1개월': '30 days',
  '3개월': '90 days',
  '1년': '365 days',
};
const INTRADAY = '1일';
const CACHE_TTL_S = 15;

interface FlowPoint {
  time: number;
  foreignNet: number;
  institutionNet: number;
  individualNet: number;
  status: string;
}

async function getIntraday(market: FlowMarket): Promise<FlowPoint[]> {
  const { rows } = await dbPool.query<FlowPoint>(
    `WITH latest AS (SELECT max(time) AS t FROM investor_flows WHERE market = $1)
     SELECT (extract(epoch FROM f.time) * 1000)::float8 AS time,
            f.foreign_net AS "foreignNet", f.institution_net AS "institutionNet", f.individual_net AS "individualNet", f.status
     FROM investor_flows f, latest
     WHERE f.market = $1 AND latest.t IS NOT NULL
       AND f.time >= (date_trunc('day', latest.t AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')
     ORDER BY f.time`,
    [market]
  );
  return rows;
}

async function getDaily(market: FlowMarket, range: string): Promise<FlowPoint[]> {
  const { rows } = await dbPool.query<FlowPoint>(
    `SELECT (extract(epoch FROM time_bucket(INTERVAL '1 day', time, 'Asia/Seoul')) * 1000)::float8 AS time,
            last(foreign_net, time) AS "foreignNet", last(institution_net, time) AS "institutionNet",
            last(individual_net, time) AS "individualNet", last(status, time) AS status
     FROM investor_flows
     WHERE market = $1 AND time >= now() - $2::interval
     GROUP BY 1
     ORDER BY 1`,
    [market, range]
  );
  return rows;
}

export const flowsController = async (fastify: FastifyInstance) => {
  fastify.get('/api/v1/flows/investors', async (request, reply) => {
    const startedAt = Date.now();
    const { market, range } = request.query as { market?: string; range?: string };

    if (!isFlowMarket(market) || !range || (range !== INTRADAY && !DAILY_RANGES[range])) {
      return reply.code(400).send({ error: 'a known market and range are required' });
    }

    try {
      const cacheKey = `flows:${market}:${range}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        flowsDuration.observe({ result: 'cache_hit' }, Date.now() - startedAt);
        return JSON.parse(cached);
      }

      const dailyInterval = DAILY_RANGES[range];
      const data = range === INTRADAY || !dailyInterval ? await getIntraday(market) : await getDaily(market, dailyInterval);
      const payload = { market, range, unit: 'million_krw', data };
      await redis.set(cacheKey, JSON.stringify(payload), 'EX', CACHE_TTL_S);
      flowsDuration.observe({ result: 'cache_miss' }, Date.now() - startedAt);
      return payload;
    } catch (err) {
      flowsDuration.observe({ result: 'error' }, Date.now() - startedAt);
      console.error(`Error fetching investor flows for ${market}:`, err);
      return reply.code(500).send({ error: 'Failed to fetch investor flows' });
    }
  });
};
