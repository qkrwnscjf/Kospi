import type { FastifyInstance } from 'fastify';
import { redis } from '../../infrastructure/redis.js';
import { dbPool } from '../../infrastructure/db.js';
import { Latency } from '../../infrastructure/metrics.js';
import { isSubscribableSymbol, isYahooSymbolKey } from '../../shared/symbols.js';
import type { YahooSymbolKey } from '../../shared/symbols.js';
import { isKrxDailySymbol, KRX_SECTOR_KEYS, type KrxDailySymbol } from '../../shared/krx-indices.js';

// 측정 지표 (docs/Task_ORDER.md T-01, BENCHMARK M-11)
const historyDuration = new Latency('kospi_history_request_duration_seconds', 'History API response time by result (cache_hit / cache_miss / not_ready / error)');
const selfCheckDuration = new Latency('kospi_history_self_check_duration_seconds', 'History self-check DB query time (cache bypassed)');
const recentDuration = new Latency('kospi_history_recent_duration_seconds', 'Recent ticks API response time by result (cache_hit / cache_miss / not_ready / error)');

// 실시간 차트의 첫 화면용 최근 tick (docs/Task_ORDER.md T-25, D-29)
// 원본 테이블(market_ticks, 3시간 보관)에서 심볼별 최근 tick을 돌려준다. 실시간 차트와 같은 해상도라 이어 붙여도 섞이지 않는다.
// 개수는 고정이라 요청마다 다른 값으로 캐시나 DB를 부풀릴 수 없다.
const RECENT_TICKS_LIMIT = 50;
const RECENT_CACHE_TTL_S = 5;

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

// KRX 일별 지수 (T-67): 하루 1개 값이라 1주 ~ 1년만 제공한다. "1일"은 일별 시세로 그릴 수 없어서 daily_only로 알린다.
async function getDailyIndexHistory(ticker: KrxDailySymbol, timeframe: Timeframe): Promise<HistoryPoint[]> {
  const { range } = DB_TIMEFRAMES[timeframe];
  const { rows } = await dbPool.query<HistoryPoint>(
    `SELECT (extract(epoch FROM time) * 1000)::float8 AS time, close::float8 AS value
     FROM index_daily
     WHERE symbol = $1 AND time >= now() - $2::interval
     ORDER BY time`,
    [ticker, range]
  );
  return rows;
}

// 섹터 기간 수익률 (D-66, 화면의 섹터 노드). 섹터마다 기간 안의 첫 종가 대비 마지막 종가.
// 섹터 목록은 고정 표에서만 가져오고, 기간은 고정 표(DB_TIMEFRAMES)에서 고른다.
const SECTOR_RETURNS_CACHE_TTL_S = 60;
interface SectorReturn { symbol: string; returnPct: number | null; last: number; dayChangeRate: number; lastTime: number; points: number }

export async function getSectorReturns(timeframe: Timeframe): Promise<SectorReturn[]> {
  const { range } = DB_TIMEFRAMES[timeframe];
  const { rows } = await dbPool.query<{ symbol: string; first: number; last: number; dayChangeRate: number; lastTime: number; points: number }>(
    `SELECT symbol,
            (array_agg(close ORDER BY time))[1] AS first,
            (array_agg(close ORDER BY time DESC))[1] AS last,
            (array_agg(change_rate ORDER BY time DESC))[1] AS "dayChangeRate",
            (extract(epoch FROM max(time)) * 1000)::float8 AS "lastTime",
            count(*)::int AS points
     FROM index_daily
     WHERE symbol = ANY($1::text[]) AND time >= now() - $2::interval
     GROUP BY symbol`,
    [KRX_SECTOR_KEYS, range]
  );
  // 점이 2개 미만이면 수익률을 0이 아니라 null(계산 불가)로 둔다
  return rows.map(row => ({
    symbol: row.symbol,
    returnPct: row.points >= 2 && row.first > 0 ? (row.last / row.first - 1) * 100 : null,
    last: row.last,
    dayChangeRate: row.dayChangeRate,
    lastTime: row.lastTime,
    points: row.points,
  }));
}

// 최근 tick (T-25). 시각은 소스 기준 시각(실시간 tick의 timestamp와 같은 기준)이다.
async function getRecentTicks(ticker: YahooSymbolKey): Promise<HistoryPoint[]> {
  const { rows } = await dbPool.query<HistoryPoint>(
    `SELECT (extract(epoch FROM time) * 1000)::float8 AS time, price::float8 AS value
     FROM market_ticks
     WHERE symbol = $1
     ORDER BY time DESC
     LIMIT $2`,
    [ticker, RECENT_TICKS_LIMIT]
  );
  return rows.reverse();
}

export const historyController = async (fastify: FastifyInstance) => {
  fastify.get('/api/v1/market/recent', async (request, reply) => {
    const startedAt = Date.now();
    const { ticker } = request.query as { ticker?: string };

    // 알 수 없는 심볼은 받지 않는다. 응답에도 받은 값을 되돌려 쓰지 않는다 (SEC-005와 같은 기준).
    if (!isSubscribableSymbol(ticker)) {
      return reply.code(400).send({ error: 'a known ticker is required' });
    }
    if (!isYahooSymbolKey(ticker)) {
      recentDuration.observe({ result: 'not_ready' }, Date.now() - startedAt);
      return { ticker, data: [], status: 'not_ready' };
    }

    try {
      const cacheKey = `recent:${ticker}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        recentDuration.observe({ result: 'cache_hit' }, Date.now() - startedAt);
        return JSON.parse(cached);
      }

      const responsePayload = { ticker, data: await getRecentTicks(ticker) };
      await redis.set(cacheKey, JSON.stringify(responsePayload), 'EX', RECENT_CACHE_TTL_S);
      recentDuration.observe({ result: 'cache_miss' }, Date.now() - startedAt);
      return responsePayload;
    } catch (err) {
      recentDuration.observe({ result: 'error' }, Date.now() - startedAt);
      console.error(`Error fetching recent ticks for ${ticker}:`, err);
      return reply.code(500).send({ error: 'Failed to fetch recent ticks' });
    }
  });

  // 섹터 기간 수익률 (D-66). "1일"은 일별 시세로 계산할 수 없어 받지 않는다.
  fastify.get('/api/v1/market/sector-returns', async (request, reply) => {
    const startedAt = Date.now();
    const { range } = request.query as { range?: string };
    if (!range || range === '1일' || !isTimeframe(range)) {
      return reply.code(400).send({ error: 'a valid range (1주, 1개월, 3개월, 1년) is required' });
    }
    try {
      const cacheKey = `sector-returns:${range}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        historyDuration.observe({ result: 'cache_hit' }, Date.now() - startedAt);
        return JSON.parse(cached);
      }
      const payload = { range, data: await getSectorReturns(range) };
      await redis.set(cacheKey, JSON.stringify(payload), 'EX', SECTOR_RETURNS_CACHE_TTL_S);
      historyDuration.observe({ result: 'cache_miss' }, Date.now() - startedAt);
      return payload;
    } catch (err) {
      historyDuration.observe({ result: 'error' }, Date.now() - startedAt);
      console.error('Error fetching sector returns:', err);
      return reply.code(500).send({ error: 'Failed to fetch sector returns' });
    }
  });

  fastify.get('/api/v1/market/history', async (request, reply) => {
    const startedAt = Date.now();
    const { ticker, timeframe } = request.query as { ticker?: string; timeframe?: string };

    if (!ticker || !timeframe || !isTimeframe(timeframe)) {
      return reply.code(400).send({ error: 'ticker and a valid timeframe are required' });
    }

    // KRX 일별 지수(VKOSPI·섹터 5종, T-67)는 index_daily에서, "1일"은 일별 시세로 그릴 수 없어서 daily_only
    const daily = isKrxDailySymbol(ticker);
    if (daily && timeframe === '1일') {
      historyDuration.observe({ result: 'not_ready' }, Date.now() - startedAt);
      return { ticker, timeframe, data: [], status: 'daily_only' };
    }
    // 그 밖에 Yahoo 심볼이 없는 지표는 mock 대신 "준비 중"을 돌려준다 (R-04, T-20)
    if (!daily && !isYahooSymbolKey(ticker)) {
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

      const data = daily ? await getDailyIndexHistory(ticker, timeframe) : await getHistory(ticker as YahooSymbolKey, timeframe);
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

      // 최근 tick API (T-25)
      const startedAt = Date.now();
      try {
        const data = await getRecentTicks(ticker);
        const last = data[data.length - 1];
        const ordered = data.every((point, index) => index === 0 || point.time > (data[index - 1]?.time ?? 0));
        results.push({
          ticker,
          timeframe: 'recent',
          points: data.length,
          last_age_s: last ? Math.round((Date.now() - last.time) / 1000) : null,
          ordered,
          non_positive: data.filter(point => point.value <= 0).length,
          ms: Date.now() - startedAt,
        });
      } catch (error) {
        results.push({ ticker, timeframe: 'recent', error: error instanceof Error ? error.message : String(error) });
      }
    }
    console.log(`[history-check] ${JSON.stringify({ results })}`);

    // 섹터 수익률 (D-66): 섹터 수, 계산된 수, 최고·최저 수익률만 남긴다
    try {
      const sectors = await getSectorReturns('1개월');
      const valid = sectors.filter(sector => sector.returnPct !== null).sort((a, b) => (b.returnPct ?? 0) - (a.returnPct ?? 0));
      const round = (value: number | null | undefined) => (value === null || value === undefined ? null : Math.round(value * 100) / 100);
      console.log(`[sector-check] ${JSON.stringify({
        range: '1개월', sectors: sectors.length, withReturn: valid.length,
        top: valid[0] ? { symbol: valid[0].symbol, returnPct: round(valid[0].returnPct) } : null,
        bottom: valid.at(-1) ? { symbol: valid.at(-1)?.symbol, returnPct: round(valid.at(-1)?.returnPct) } : null,
        minPoints: Math.min(...sectors.map(sector => sector.points)),
      })}`);
    } catch (error) {
      console.error(`[sector-check] failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, 60000);
}
