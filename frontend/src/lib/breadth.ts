// 시장 폭·거래대금 표시 (docs/Task_ORDER.md T-106)
// 테스트할 수 있도록 React와 분리한 순수 함수다. 다른 모듈을 import하지 않는다.

export interface BreadthPoint {
  time: number
  advancers: number
  decliners: number
  unchanged: number
  stocks: number
  tradingValue: number // 원
}

export const BREADTH_MARKETS = ['KOSPI', 'KOSDAQ'] as const
export type BreadthMarket = (typeof BREADTH_MARKETS)[number]

export const BREADTH_MARKET_LABELS: Record<BreadthMarket, string> = { KOSPI: '유가증권(코스피)', KOSDAQ: '코스닥' }

// 거래대금: 1조 이상은 "12.3조원", 그 아래는 "8,500억원"
export function formatTradingValue(won: number) {
  if (!Number.isFinite(won) || won < 0) return '—'
  const jo = won / 1e12
  if (jo >= 1) return `${jo.toFixed(1)}조원`
  return `${Math.round(won / 1e8).toLocaleString('ko-KR')}억원`
}

// 순상승 종목 수(상승 − 하락). 막대 그래프의 값
export const netAdvancers = (point: BreadthPoint) => point.advancers - point.decliners

// 상승·보합·하락 비율(%). 합은 100
export function breadthShares(point: BreadthPoint) {
  if (point.stocks <= 0) return { up: 0, flat: 0, down: 0 }
  const up = (point.advancers / point.stocks) * 100
  const down = (point.decliners / point.stocks) * 100
  return { up, flat: Math.max(0, 100 - up - down), down }
}
