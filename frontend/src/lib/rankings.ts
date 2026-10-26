// 종목 순위 표시 (docs/Task_ORDER.md T-113)
// 테스트할 수 있도록 React와 분리한 순수 함수다. 다른 모듈을 import하지 않는다.

export const RANKING_VIEWS = [
  { key: 'gain', label: '상승률' },
  { key: 'loss', label: '하락률' },
  { key: 'value', label: '거래대금' },
  { key: 'cap', label: '시가총액' },
] as const
export type RankingView = (typeof RANKING_VIEWS)[number]['key']

export const RANKING_MARKETS = [
  { key: 'KOSPI', label: '유가증권(코스피)' },
  { key: 'KOSDAQ', label: '코스닥' },
] as const

export interface RankingItem {
  rank: number
  code: string
  name: string
  close: number
  changeRate: number | null
  tradingValue: number | null
  marketCap: number | null
}

const isNullableNumber = (value: unknown): value is number | null => value === null || (typeof value === 'number' && Number.isFinite(value))

export function toRankingItems(raw: unknown): RankingItem[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const { rank, code, name, close, changeRate, tradingValue, marketCap } = item as Record<string, unknown>
    if (typeof rank !== 'number' || typeof code !== 'string' || !/^[0-9A-Z]{6}$/.test(code) || typeof name !== 'string' || typeof close !== 'number') return []
    if (!isNullableNumber(changeRate) || !isNullableNumber(tradingValue) || !isNullableNumber(marketCap)) return []
    return [{ rank, code, name, close, changeRate, tradingValue, marketCap }]
  })
}

// 원 → "12.3조" / "8,500억" / "320억"
export function formatWonShort(won: number | null) {
  if (won === null || !Number.isFinite(won)) return '—'
  if (won >= 1e12) return `${(won / 1e12).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}조`
  return `${Math.round(won / 1e8).toLocaleString('ko-KR')}억`
}
