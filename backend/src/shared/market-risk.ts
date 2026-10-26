// 시장 연관성·리스크 (docs/Task_ORDER.md 15단계 T-110, D-72)
// 이미 저장된 일봉(집계 + 과거 일봉)으로 조회할 때 계산한다. 저장하지 않는다(장단기 금리차 T-107과 같은 방식).
// 테스트할 수 있도록 DB와 분리한 순수 함수다.
// - 상관계수·베타는 일간 수익률(금리는 일간 변화량) 기준.
// - 한국 장이 미국·환율보다 먼저 닫히므로, 같은 날짜끼리(동시)와 "상대 지표의 직전 거래일 → 코스피 당일"(선행)을 함께 계산한다.
// - 오늘(UTC 날짜) 버킷은 아직 확정되지 않은 장중 값일 수 있어 뺀다.

export const RISK_BASE = 'KOSPI';

// mode: return = 수익률(%), change = 수준의 변화량(%p, 금리). drawdown: 최대 낙폭이 의미 있는 지표인지
export const RISK_TARGETS = [
  { symbol: 'SP500', mode: 'return', drawdown: true },
  { symbol: 'NASDAQ', mode: 'return', drawdown: true },
  { symbol: 'SOX', mode: 'return', drawdown: true },
  { symbol: 'USD/KRW', mode: 'return', drawdown: false },
  { symbol: 'VIX', mode: 'return', drawdown: false },
  { symbol: 'US10Y', mode: 'change', drawdown: false },
] as const;

export type RiskMode = 'return' | 'change';

// 기간(일). History API와 같은 이름을 쓴다
export const RISK_RANGES = { '1개월': 30, '3개월': 90, '1년': 365 } as const;
export type RiskRange = keyof typeof RISK_RANGES;
export const isRiskRange = (value: unknown): value is RiskRange =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(RISK_RANGES, value);

// 짝지은 수익률이 이보다 적으면 상관계수·베타를 계산하지 않는다(null). 1개월이면 약 20개
export const MIN_PAIRS = 10;
const TRADING_DAYS_PER_YEAR = 252;
const DAY_MS = 86_400_000;

export interface Point { time: number; value: number }

// 기간 안의 확정된 점만: [now − 기간, 오늘 UTC 0시)
export function windowPoints(points: Point[], days: number, nowMs: number): Point[] {
  const todayStart = Math.floor(nowMs / DAY_MS) * DAY_MS;
  const from = nowMs - days * DAY_MS;
  return points
    .filter(point => point.time >= from && point.time < todayStart && Number.isFinite(point.value))
    .sort((a, b) => a.time - b.time);
}

// 연속한 두 점 사이의 변화. 수익률은 이전 값이 0 이하이면 건너뛴다
export function toChanges(points: Point[], mode: RiskMode): Point[] {
  const changes: Point[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    if (mode === 'return') {
      if (previous.value > 0) changes.push({ time: current.time, value: (current.value / previous.value - 1) * 100 });
    } else {
      changes.push({ time: current.time, value: current.value - previous.value });
    }
  }
  return changes;
}

// 같은 날짜(버킷)끼리 짝짓기
export function pairSameDay(base: Point[], other: Point[]): [number, number][] {
  const otherByTime = new Map(other.map(point => [point.time, point.value]));
  return base.flatMap(point => {
    const value = otherByTime.get(point.time);
    return value === undefined ? [] : [[point.value, value] as [number, number]];
  });
}

// 코스피 날짜마다 그보다 이전인 상대 지표의 가장 최근 변화와 짝짓기 (선행 관계)
export function pairLagged(base: Point[], other: Point[]): [number, number][] {
  const pairs: [number, number][] = [];
  let cursor = -1;
  for (const point of base) {
    while (cursor + 1 < other.length && other[cursor + 1]!.time < point.time) cursor += 1;
    const previous = cursor >= 0 ? other[cursor] : undefined;
    if (previous) pairs.push([point.value, previous.value]);
  }
  return pairs;
}

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

// 피어슨 상관계수. 짝이 적거나 한쪽이 변하지 않으면 null
export function correlation(pairs: [number, number][]): number | null {
  if (pairs.length < MIN_PAIRS) return null;
  const meanX = mean(pairs.map(pair => pair[0]));
  const meanY = mean(pairs.map(pair => pair[1]));
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (const [x, y] of pairs) {
    covariance += (x - meanX) * (y - meanY);
    varianceX += (x - meanX) ** 2;
    varianceY += (y - meanY) ** 2;
  }
  if (varianceX === 0 || varianceY === 0) return null;
  return covariance / Math.sqrt(varianceX * varianceY);
}

// 베타: 상대 지표가 1(%, 금리는 1%p) 움직일 때 코스피가 움직인 정도(%). 짝의 첫 값이 코스피
export function beta(pairs: [number, number][]): number | null {
  if (pairs.length < MIN_PAIRS) return null;
  const meanX = mean(pairs.map(pair => pair[0]));
  const meanY = mean(pairs.map(pair => pair[1]));
  let covariance = 0;
  let varianceY = 0;
  for (const [x, y] of pairs) {
    covariance += (x - meanX) * (y - meanY);
    varianceY += (y - meanY) ** 2;
  }
  return varianceY === 0 ? null : covariance / varianceY;
}

// 연환산 변동성: 일간 변화의 표본 표준편차 × √252
export function annualizedVolatility(changes: Point[]): number | null {
  if (changes.length < MIN_PAIRS) return null;
  const values = changes.map(point => point.value);
  const average = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

// 최대 낙폭(%): 기간 중 고점 대비 가장 크게 떨어진 비율. 0 이하(음수)로 돌려준다
export function maxDrawdown(points: Point[]): number | null {
  if (points.length < 2) return null;
  let peak = points[0]!.value;
  let worst = 0;
  for (const point of points) {
    if (point.value > peak) peak = point.value;
    if (peak > 0) worst = Math.min(worst, (point.value / peak - 1) * 100);
  }
  return worst;
}

export interface SeriesStats {
  points: number;
  last: number | null;
  lastTime: number | null;
  periodChange: number | null;  // return: 기간 수익률(%), change: 기간 변화량(%p)
  volatility: number | null;    // 연환산(%, 금리는 %p)
  maxDrawdown: number | null;   // %, 의미 없는 지표는 null
}

export function seriesStats(points: Point[], mode: RiskMode, drawdown: boolean): SeriesStats {
  const first = points[0];
  const last = points[points.length - 1];
  const periodChange = !first || !last || points.length < 2
    ? null
    : mode === 'return'
      ? (first.value > 0 ? (last.value / first.value - 1) * 100 : null)
      : last.value - first.value;
  return {
    points: points.length,
    last: last?.value ?? null,
    lastTime: last?.time ?? null,
    periodChange,
    volatility: annualizedVolatility(toChanges(points, mode)),
    maxDrawdown: drawdown ? maxDrawdown(points) : null,
  };
}

export interface TargetRisk {
  symbol: string;
  mode: RiskMode;
  stats: SeriesStats;
  sameDay: { correlation: number | null; beta: number | null; pairs: number };
  lagged: { correlation: number | null; beta: number | null; pairs: number };
}

export interface MarketRisk {
  range: RiskRange;
  base: { symbol: string; stats: SeriesStats };
  targets: TargetRisk[];
}

const round = (value: number | null, digits: number) => (value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits);
const roundStats = (stats: SeriesStats): SeriesStats => ({
  ...stats,
  periodChange: round(stats.periodChange, 3),
  volatility: round(stats.volatility, 3),
  maxDrawdown: round(stats.maxDrawdown, 3),
});

// 기준(코스피)과 상대 지표들의 1년치 일봉 → 요청 기간의 지표
export function computeMarketRisk(range: RiskRange, series: Record<string, Point[]>, nowMs: number): MarketRisk {
  const days = RISK_RANGES[range];
  const basePoints = windowPoints(series[RISK_BASE] ?? [], days, nowMs);
  const baseChanges = toChanges(basePoints, 'return');
  const targets = RISK_TARGETS.map(target => {
    const points = windowPoints(series[target.symbol] ?? [], days, nowMs);
    const changes = toChanges(points, target.mode);
    const same = pairSameDay(baseChanges, changes);
    const lag = pairLagged(baseChanges, changes);
    return {
      symbol: target.symbol,
      mode: target.mode,
      stats: roundStats(seriesStats(points, target.mode, target.drawdown)),
      sameDay: { correlation: round(correlation(same), 3), beta: round(beta(same), 3), pairs: same.length },
      lagged: { correlation: round(correlation(lag), 3), beta: round(beta(lag), 3), pairs: lag.length },
    };
  });
  return { range, base: { symbol: RISK_BASE, stats: roundStats(seriesStats(basePoints, 'return', true)) }, targets };
}
