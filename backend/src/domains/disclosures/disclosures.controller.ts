import type { FastifyInstance } from 'fastify';
import { redis } from '../../infrastructure/redis.js';
import { dbPool } from '../../infrastructure/db.js';
import { Latency } from '../../infrastructure/metrics.js';
import { DISCLOSURE_SCOPE, isDisclosureGroup, targetStockCodes } from '../../shared/disclosures.js';
import { KOSPI100 } from '../../shared/disclosure-targets.js';

// 공시·자본 이벤트 조회 API (docs/Task_ORDER.md 12단계 T-77)
// GET /api/v1/disclosures/recent?group=all|dilution|...      최근 공시 100건 (개수 고정)
// GET /api/v1/disclosures/capital-events?range=1주|1개월|3개월|1년   기간별 희석·주주환원·자사주 처분 금액과 건수
// 그룹·기간은 고정된 표에서만 고르고, 값은 매개변수로만 SQL에 넘긴다. KOSPI 100 명단이 있으면 그 종목만 조회한다.

const requestDuration = new Latency('kospi_disclosures_request_duration_seconds', 'Disclosures API response time by endpoint and result');

const RECENT_LIMIT = 100;
const RECENT_CACHE_TTL_S = 10;
const EVENTS_CACHE_TTL_S = 60;
// 기간 → 조회 범위(일)와 묶음 단위
const RANGES: Record<string, { days: number; bucket: 'day' | 'week' }> = {
  '1주': { days: 7, bucket: 'day' },
  '1개월': { days: 30, bucket: 'day' },
  '3개월': { days: 90, bucket: 'week' },
  '1년': { days: 365, bucket: 'week' },
};
const CAPITAL_GROUPS = ['dilution', 'shareholder_return', 'treasury_disposal'];

// 대상 종목 조건 (명단이 없으면 조건 없음). 종목코드 배열은 매개변수로 넘긴다.
const targetCodes = targetStockCodes();
const targetClause = (param: number) => (targetCodes.length > 0 ? `AND stock_code = ANY($${param}::text[])` : '');
const targetParams = () => (targetCodes.length > 0 ? [targetCodes] : []);

const scopeInfo = () => ({ scope: DISCLOSURE_SCOPE, scopeAsOf: KOSPI100.asOf });

async function getRecent(group: string) {
  const groupClause = group === 'all' ? '' : 'AND event_group = $2';
  const params: unknown[] = [RECENT_LIMIT];
  if (group !== 'all') params.push(group);
  const { rows } = await dbPool.query(
    `SELECT rcept_no AS "rceptNo", to_char(rcept_date, 'YYYY-MM-DD') AS "rceptDate", stock_code AS "stockCode",
            corp_name AS "corpName", report_name AS "reportName", event_group AS "group", event_kind AS "kind",
            is_correction AS "isCorrection", amount
     FROM disclosures
     WHERE rcept_date >= current_date - 30 ${groupClause} ${targetClause(params.length + 1)}
     ORDER BY rcept_no DESC
     LIMIT $1`,
    [...params, ...targetParams()]
  );
  return rows;
}

// 저장된 전체 범위(첫·마지막 접수일). 수집기가 시작할 때 빠진 기간만 채우는 데 쓴다 (docs/security.md SEC-014).
// 날짜 두 개만 돌려주며, 대상 범위와 상관없이 테이블 전체 기준이다.
async function getCoverage() {
  const { rows } = await dbPool.query<{ since: string | null; until: string | null }>(
    `SELECT to_char(min(rcept_date), 'YYYY-MM-DD') AS since, to_char(max(rcept_date), 'YYYY-MM-DD') AS until FROM disclosures`
  );
  return { since: rows[0]?.since ?? null, until: rows[0]?.until ?? null };
}

async function getCapitalEvents(days: number, bucket: 'day' | 'week') {
  const bucketExpr = bucket === 'day' ? 'rcept_date' : `time_bucket(INTERVAL '1 week', rcept_date)`;
  const base = [days, CAPITAL_GROUPS];
  // 정정 공시는 원 공시와 금액이 겹치므로 합계에서 뺀다
  const where = `rcept_date >= current_date - $1::int AND event_group = ANY($2::text[]) AND NOT is_correction ${targetClause(3)}`;
  const params = [...base, ...targetParams()];

  const buckets = await dbPool.query(
    `SELECT to_char(${bucketExpr}, 'YYYY-MM-DD') AS "date",
            COALESCE(sum(amount) FILTER (WHERE event_group = 'dilution'), 0)::float8 AS "dilution",
            COALESCE(sum(amount) FILTER (WHERE event_group = 'shareholder_return'), 0)::float8 AS "shareholderReturn",
            COALESCE(sum(amount) FILTER (WHERE event_group = 'treasury_disposal'), 0)::float8 AS "treasuryDisposal",
            count(*) FILTER (WHERE event_group = 'dilution')::int AS "dilutionCount",
            count(*) FILTER (WHERE event_group = 'shareholder_return')::int AS "shareholderReturnCount",
            count(*) FILTER (WHERE event_group = 'treasury_disposal')::int AS "treasuryDisposalCount",
            count(*) FILTER (WHERE amount IS NULL)::int AS "missingAmountCount"
     FROM disclosures WHERE ${where}
     GROUP BY 1 ORDER BY 1`,
    params
  );
  const top = await dbPool.query(
    `SELECT rcept_no AS "rceptNo", to_char(rcept_date, 'YYYY-MM-DD') AS "rceptDate", corp_name AS "corpName",
            report_name AS "reportName", event_group AS "group", event_kind AS "kind", amount
     FROM disclosures WHERE ${where} AND amount IS NOT NULL
     ORDER BY amount DESC LIMIT 5`,
    params
  );
  // 이 기간 중 언제부터 데이터가 있는지 (수집 시작 이후만 정확함)
  const coverage = await dbPool.query<{ since: string | null }>(
    `SELECT to_char(min(rcept_date), 'YYYY-MM-DD') AS since FROM disclosures WHERE rcept_date >= current_date - $1::int`,
    [days]
  );
  return { buckets: buckets.rows, top: top.rows, since: coverage.rows[0]?.since ?? null };
}

async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<{ value: T; hit: boolean }> {
  const hit = await redis.get(key);
  if (hit) return { value: JSON.parse(hit) as T, hit: true };
  const value = await load();
  await redis.set(key, JSON.stringify(value), 'EX', ttl);
  return { value, hit: false };
}

export const disclosuresController = async (fastify: FastifyInstance) => {
  fastify.get('/api/v1/disclosures/recent', async (request, reply) => {
    const startedAt = Date.now();
    const { group = 'all' } = request.query as { group?: string };
    if (group !== 'all' && !isDisclosureGroup(group)) {
      return reply.code(400).send({ error: 'a known group is required' });
    }
    try {
      const { value, hit } = await cached(`disclosures:recent:${group}`, RECENT_CACHE_TTL_S, async () => ({
        group, ...scopeInfo(), coverage: await getCoverage(), data: await getRecent(group),
      }));
      requestDuration.observe({ endpoint: 'recent', result: hit ? 'cache_hit' : 'cache_miss' }, Date.now() - startedAt);
      return value;
    } catch (err) {
      requestDuration.observe({ endpoint: 'recent', result: 'error' }, Date.now() - startedAt);
      console.error('Error fetching recent disclosures:', err);
      return reply.code(500).send({ error: 'Failed to fetch disclosures' });
    }
  });

  fastify.get('/api/v1/disclosures/capital-events', async (request, reply) => {
    const startedAt = Date.now();
    const { range } = request.query as { range?: string };
    const config = range ? RANGES[range] : undefined;
    if (!range || !config) {
      return reply.code(400).send({ error: 'a known range is required' });
    }
    try {
      const { value, hit } = await cached(`disclosures:events:${range}`, EVENTS_CACHE_TTL_S, async () => ({
        range, unit: 'krw', bucket: config.bucket, ...scopeInfo(), ...(await getCapitalEvents(config.days, config.bucket)),
      }));
      requestDuration.observe({ endpoint: 'capital_events', result: hit ? 'cache_hit' : 'cache_miss' }, Date.now() - startedAt);
      return value;
    } catch (err) {
      requestDuration.observe({ endpoint: 'capital_events', result: 'error' }, Date.now() - startedAt);
      console.error('Error fetching capital events:', err);
      return reply.code(500).send({ error: 'Failed to fetch capital events' });
    }
  });
};
