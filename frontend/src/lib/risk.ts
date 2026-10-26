// 시장 연관성·리스크 표시 (docs/Task_ORDER.md T-110)
// 테스트할 수 있도록 React와 분리한 순수 함수다. 다른 모듈을 import하지 않는다.

export const RISK_RANGES = ['1개월', '3개월', '1년'] as const

export const RISK_LABELS: Record<string, string> = {
  KOSPI: '코스피',
  SP500: 'S&P 500',
  NASDAQ: '나스닥 100',
  SOX: '필라델피아 반도체',
  'USD/KRW': '원/달러 환율',
  VIX: 'VIX (미국 변동성)',
  US10Y: '미 10년물 금리',
}

export interface SeriesStats {
  points: number
  last: number | null
  lastTime: number | null
  periodChange: number | null
  volatility: number | null
  maxDrawdown: number | null
}

export interface PairStats { correlation: number | null; beta: number | null; pairs: number }

export interface TargetRisk {
  symbol: string
  mode: 'return' | 'change'
  stats: SeriesStats
  sameDay: PairStats
  lagged: PairStats
}

export interface MarketRisk {
  range: string
  base: { symbol: string; stats: SeriesStats }
  targets: TargetRisk[]
}

const isNumberOrNull = (value: unknown): value is number | null => value === null || (typeof value === 'number' && Number.isFinite(value))

function toStats(raw: unknown): SeriesStats | null {
  if (!raw || typeof raw !== 'object') return null
  const { points, last, lastTime, periodChange, volatility, maxDrawdown } = raw as Record<string, unknown>
  if (typeof points !== 'number' || ![last, lastTime, periodChange, volatility, maxDrawdown].every(isNumberOrNull)) return null
  return { points, last: last as number | null, lastTime: lastTime as number | null, periodChange: periodChange as number | null, volatility: volatility as number | null, maxDrawdown: maxDrawdown as number | null }
}

function toPair(raw: unknown): PairStats | null {
  if (!raw || typeof raw !== 'object') return null
  const { correlation, beta, pairs } = raw as Record<string, unknown>
  if (!isNumberOrNull(correlation) || !isNumberOrNull(beta) || typeof pairs !== 'number') return null
  return { correlation, beta, pairs }
}

// 응답에서 형식이 맞는 값만 남긴다
export function toMarketRisk(raw: unknown): MarketRisk | null {
  if (!raw || typeof raw !== 'object') return null
  const { range, base, targets } = raw as Record<string, unknown>
  const baseStats = base && typeof base === 'object' ? toStats((base as Record<string, unknown>).stats) : null
  if (typeof range !== 'string' || !baseStats || !Array.isArray(targets)) return null
  const parsed = targets.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const { symbol, mode, stats, sameDay, lagged } = item as Record<string, unknown>
    const s = toStats(stats)
    const same = toPair(sameDay)
    const lag = toPair(lagged)
    if (typeof symbol !== 'string' || (mode !== 'return' && mode !== 'change') || !s || !same || !lag) return []
    return [{ symbol, mode, stats: s, sameDay: same, lagged: lag } as TargetRisk]
  })
  return { range, base: { symbol: String((base as Record<string, unknown>).symbol ?? 'KOSPI'), stats: baseStats }, targets: parsed }
}

// 상관계수 세기 (절댓값 기준)
export function correlationStrength(value: number | null) {
  if (value === null) return '계산 불가'
  const abs = Math.abs(value)
  const direction = value >= 0 ? '같은 방향' : '반대 방향'
  if (abs >= 0.7) return `강함 · ${direction}`
  if (abs >= 0.4) return `보통 · ${direction}`
  if (abs >= 0.2) return `약함 · ${direction}`
  return '거의 없음'
}

// −1 ~ 1 값을 가운데(50%) 기준 막대로: 시작 위치와 너비(%)
export function correlationBar(value: number | null) {
  if (value === null) return { left: 50, width: 0 }
  const clamped = Math.max(-1, Math.min(1, value))
  const width = Math.abs(clamped) * 50
  return { left: clamped >= 0 ? 50 : 50 - width, width }
}

export const formatSigned = (value: number | null, digits = 2, suffix = '') =>
  value === null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(digits)}${suffix}`
