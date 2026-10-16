import YahooFinance from 'yahoo-finance2';
import { dbPool } from '../db.js';
import { YAHOO_CATEGORY, YAHOO_KEYS, YAHOO_SYMBOLS } from '../../shared/symbols.js';
import type { YahooSymbolKey } from '../../shared/symbols.js';

// 최초 1회 과거 데이터 채우기 (docs/Task_ORDER.md T-19, R-05, D-06)
// 연속 집계에는 직접 넣을 수 없어서, 원본(market_ticks)에 종가를 넣고 → 집계를 전체 갱신하고 →
// 3시간보다 오래된 원본을 바로 지운다 (D-02). 집계는 원본이 지워져도 남는다.
// 완료 기록(backfill_runs)이 있으면 다시 실행하지 않는다.

const BACKFILL_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1000;

// 그래프별로 필요한 해상도만 받는다: 1일 그래프(5분 봉 24시간), 1주 그래프(1시간 봉 7일), 1개월~1년 그래프(1일 봉).
const RANGES = [
  { interval: '1d', days: 366 },
  { interval: '60m', days: 8 },
  { interval: '5m', days: 2 },
] as const;

const yahooFinance = new YahooFinance();

interface BackfillRow {
  time: Date;
  symbol: YahooSymbolKey;
  price: number;
  changeRate: number;
  changePrice: number;
}

async function fetchBars(symbol: YahooSymbolKey, interval: (typeof RANGES)[number]['interval'], days: number) {
  const result = await yahooFinance.chart(YAHOO_SYMBOLS[symbol], {
    period1: new Date(Date.now() - days * DAY_MS),
    interval,
  });

  // 종가가 없거나 0 이하인 봉은 넣지 않는다 (이전 History API는 이런 봉을 0으로 바꿨다, T-21).
  const bars = result.quotes.filter(
    quote => quote.date instanceof Date && typeof quote.close === 'number' && Number.isFinite(quote.close) && quote.close > 0
  );

  // 등락은 직전 봉 종가 대비로 계산한다. 비교할 직전 봉이 없는 첫 봉은 넣지 않는다 (값 없음을 0으로 채우지 않기 위함).
  const rows: BackfillRow[] = [];
  for (let index = 1; index < bars.length; index++) {
    const previous = bars[index - 1]?.close;
    const current = bars[index];
    if (!current || typeof previous !== 'number' || typeof current.close !== 'number') continue;
    rows.push({
      time: current.date,
      symbol,
      price: current.close,
      changePrice: current.close - previous,
      changeRate: ((current.close - previous) / previous) * 100,
    });
  }
  return rows;
}

async function insertRows(rows: BackfillRow[]) {
  let inserted = 0;
  for (let start = 0; start < rows.length; start += 500) {
    const chunk = rows.slice(start, start + 500);
    const values: unknown[] = [];
    const placeholders = chunk.map((row, index) => {
      const base = index * 6;
      values.push(row.time, row.symbol, YAHOO_CATEGORY[row.symbol], row.price, row.changeRate, row.changePrice);
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
    });
    const result = await dbPool.query(
      `INSERT INTO market_ticks (time, symbol, category, price, change_rate, change_price)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (symbol, time) DO NOTHING`,
      values
    );
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}

export async function runBackfillOnce() {
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS backfill_runs (
      version INTEGER PRIMARY KEY,
      rows_inserted INTEGER NOT NULL,
      finished_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  const done = await dbPool.query('SELECT 1 FROM backfill_runs WHERE version = $1', [BACKFILL_VERSION]);
  if (done.rowCount) {
    console.log(`Backfill version ${BACKFILL_VERSION} already done, skipping.`);
    return;
  }

  console.log(`Backfill version ${BACKFILL_VERSION} starting (${YAHOO_KEYS.length} symbols x ${RANGES.length} ranges)...`);
  let inserted = 0;
  let failed = 0;
  for (const symbol of YAHOO_KEYS) {
    for (const range of RANGES) {
      try {
        const rows = await fetchBars(symbol, range.interval, range.days);
        const count = await insertRows(rows);
        inserted += count;
        console.log(`Backfill ${symbol} ${range.interval}: ${rows.length} bars, ${count} inserted`);
      } catch (error) {
        failed += 1;
        console.error(`Backfill ${symbol} ${range.interval} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  // 일부라도 실패하면 완료로 기록하지 않는다. 다음 기동에서 다시 시도한다 (이미 넣은 행은 유니크 제약으로 건너뜀).
  if (failed > 0) {
    throw new Error(`Backfill incomplete: ${failed} requests failed`);
  }

  // 집계를 아래 단계부터 전체 갱신한다 (계층형이라 순서가 중요, D-23).
  for (const view of ['market_5m', 'market_1h', 'market_1d']) {
    await dbPool.query(`CALL refresh_continuous_aggregate('${view}', NULL, NULL)`);
  }
  // 집계에 반영된 오래된 원본을 바로 지운다. 보관 정책(3시간)과 같은 기준이다 (D-02).
  const dropped = await dbPool.query(`SELECT drop_chunks('market_ticks', older_than => INTERVAL '3 hours')`);

  await dbPool.query('INSERT INTO backfill_runs (version, rows_inserted) VALUES ($1, $2)', [BACKFILL_VERSION, inserted]);
  console.log(`Backfill version ${BACKFILL_VERSION} done: ${inserted} rows inserted, aggregates refreshed, ${dropped.rowCount ?? 0} old raw chunks dropped.`);
}
