import type { FastifyInstance } from 'fastify';
import { redis } from '../../infrastructure/redis.js';
import { dbPool } from '../../infrastructure/db.js';
import { Latency } from '../../infrastructure/metrics.js';
import { isYahooSymbolKey } from '../../shared/symbols.js';
import type { YahooSymbolKey } from '../../shared/symbols.js';

// 측정 지표 (docs/Task_ORDER.md T-01, BENCHMARK M-11)
const historyDuration = new Latency('kospi_history_request_duration_seconds', 'History API response time by result (cache_hit / cache_miss / not_ready / error)');
const selfCheckDuration = new Latency('kospi_history_self_check_duration_seconds', 'History self-check DB query time (cache bypassed)');

type Timeframe = '1일' | '1주' | '1개월' | '3개월' | '1년';
type HistoryPoint = { time: number; value: number };

// DB 집계 조회 (docs/Task_ORDER.md T-20). 집계 이름은 이 고정된 표에서만 고른다 (사용자 입력으로 SQL을 만들지 않음).
const DB_TIMEFRAMES: Record<Timeframe, { view: string; range: string }> = {
  '1일': { view: 'market_5m', range: '1 day' },    // T-21: 이전에는 2일치를 보여 줬다
  '1주': { view: 'market_1h', range: '7 days' },
  '1개월': { view: 'market_1d', range: '30 days' },
  '3개월': { view: 'market_1d', range: '90 days' },
  '1년': { view: 'market_1d', range: '365 days' },
};
const TIMEFRAMES = Object.keys(DB_TIMEFRAMES) as Timeframe[];
const isTimeframe = (value: string): value is Timeframe => Object.prototype.hasOwnProperty.call(DB_TIMEFRAMES, value);

// 검증용 자체 점검 (기본 끔)
const HISTORY_SELF_CHECK = process.env.HISTORY_SELF_CHECK === 'true';
// DB 조회가 p50 약 23ms라서(BENCHMARK B-06) 캐시로 아끼는 시간은 수십 ms다. 그래프가 늦게 반영되지 않도록 30초로 짧게 둔다 (D-24).
// 이전 300초 TTL에서는 그래프가 최대 5분 늦게 반영되었다.
const HISTORY_CACHE_TTL_S = Number.parseInt(process.env.HISTORY_CACHE_TTL_S ?? '', 10) || 30;

// DB 집계 조회 (T-20). B-06에서 Yahoo 직접 호출보다 약 6배 빠르고, "1일" 기간 오류와 0값이 없어서 채택했다.
async function getHistory(ticker: YahooSymbolKey, timeframe: Timeframe): Promise<HistoryPoint[]> {
  const { view, range } = DB_TIMEFRAMES[timeframe];
  const { rows } = await dbPool.query<HistoryPoint>(
    `SELECT (extract(epoch FROM bucket) * 1000)::float8 AS time, close::float8 AS value
     FROM ${view}
     WHERE symbol = $1 AND bucket >= now() - $2::interval
     ORDER BY bucket`,
    [ticker, range]
  );
  return rows;
}

export const historyController = async (fastify: FastifyInstance) => {
  fastify.get('/api/v1/market/history', async (request, reply) => {
    const startedAt = Date.now();
    const { ticker, timeframe } = request.query as { ticker?: string; timeframe?: string };

    if (!ticker || !timeframe || !isTimeframe(timeframe)) {
      return reply.code(400).send({ error: 'ticker and a valid timeframe are required' });
    }

    // Yahoo 심볼이 없는 Naver 6종은 수집이 보류 중이라(R-03) mock 대신 "준비 중"을 돌려준다 (R-04, T-20)
    if (!isYahooSymbolKey(ticker)) {
      historyDuration.observe({ result: 'not_ready' }, Date.now() - startedAt);
      return { ticker, timeframe, data: [], status: 'not_ready' };
    }

    try {
      const cacheKey = `history:db:${ticker}:${timeframe}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        historyDuration.observe({ result: 'cache_hit' }, Date.now() - startedAt);
        return JSON.parse(cached);
      }

      const data = await getHistory(ticker, timeframe);
      const responsePayload = { ticker, timeframe, data };
      await redis.set(cacheKey, JSON.stringify(responsePayload), 'EX', HISTORY_CACHE_TTL_S);

      historyDuration.observe({ result: 'cache_miss' }, Date.now() - startedAt);
      return responsePayload;
    } catch (err) {
      historyDuration.observe({ result: 'error' }, Date.now() - startedAt);
      console.error(`Error fetching historical data for ${ticker}:`, err);
      return reply.code(500).send({ error: 'Failed to fetch historical data' });
    }
  });
};

// 검증용 자체 점검 (기본 끔). 에이전트는 curl이나 브라우저를 쓸 수 없어서, backend가 직접 조회한 결과를 요약 로그로 남긴다.
// 캐시를 거치지 않으므로 조회 시간은 캐시 miss 때의 시간과 같다.
const SELF_CHECK_TICKERS: YahooSymbolKey[] = ['KOSPI', 'SP500', 'USD/KRW'];

export function startHistorySelfCheck() {
  if (!HISTORY_SELF_CHECK) return;
  console.warn('HISTORY_SELF_CHECK=true: logging history query summaries every 60s (verification only).');

  setInterval(async () => {
    const results: Record<string, unknown>[] = [];
    for (const ticker of SELF_CHECK_TICKERS) {
      for (const timeframe of TIMEFRAMES) {
        const startedAt = Date.now();
        try {
          const data = await getHistory(ticker, timeframe);
          const durationMs = Date.now() - startedAt;
          selfCheckDuration.observe({}, durationMs);
          const first = data[0];
          const last = data[data.length - 1];
          results.push({
            ticker,
            timeframe,
            points: data.length,
            span_h: first && last ? Math.round(((last.time - first.time) / 3600000) * 10) / 10 : 0,
            last_age_s: last ? Math.round((Date.now() - last.time) / 1000) : null,
            non_positive: data.filter(point => point.value <= 0).length,
            ms: durationMs,
          });
        } catch (error) {
          results.push({ ticker, timeframe, error: error instanceof Error ? error.message : String(error) });
        }
      }
    }
    console.log(`[history-check] ${JSON.stringify({ results })}`);
  }, 60000);
}
