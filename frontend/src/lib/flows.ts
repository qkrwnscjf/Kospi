// 증시 자금 흐름 계산 (docs/Task_ORDER.md 11단계 A, D-46)
// 테스트할 수 있도록 React와 분리한 순수 함수다. 다른 모듈을 import하지 않는다.

export type FlowMarket = 'KOSPI' | 'KOSDAQ'
export type InvestorKey = 'foreignNet' | 'institutionNet' | 'individualNet'

export interface FlowPoint {
  time: number
  foreignNet: number      // 백만원
  institutionNet: number
  individualNet: number
  status: string          // provisional | final
}

export const INVESTORS: { key: InvestorKey; label: string }[] = [
  { key: 'foreignNet', label: '외국인' },
  { key: 'institutionNet', label: '기관' },
  { key: 'individualNet', label: '개인' },
]

// 백만원 → 억원
export const toEok = (millionKrw: number) => millionKrw / 100

// 억원 표시: 부호와 천 단위 쉼표, 소수 없음 (예: +1,234억)
export function formatEok(millionKrw: number) {
  const eok = Math.round(toEok(millionKrw))
  const sign = eok > 0 ? '+' : ''
  return `${sign}${eok.toLocaleString('ko-KR')}억`
}

// 시각 순서를 지키며 점을 추가한다. 같은 시각이면 값만 바꾸고(잠정치 갱신), 더 이른 시각은 버린다.
export function appendFlowPoint(points: FlowPoint[], point: FlowPoint) {
  const last = points[points.length - 1]
  if (last && point.time < last.time) return points
  if (last && point.time === last.time) return [...points.slice(0, -1), point]
  return [...points, point]
}

export interface SankeyData {
  nodes: { name: string; side: 'seller' | 'market' | 'buyer'; value: number }[]
  links: { source: number; target: number; value: number }[]
}

// "오늘의 수급" 시장 중심 흐름도 (D-46): 순매도 그룹 → 시장 → 순매수 그룹.
// 투자자끼리 직접 잇지 않는다(실제 거래 상대가 아니므로). 값이 모두 0이면 null.
export function buildSankey(point: Pick<FlowPoint, InvestorKey>, marketLabel: string): SankeyData | null {
  const sellers = INVESTORS.filter(investor => point[investor.key] < 0)
  const buyers = INVESTORS.filter(investor => point[investor.key] > 0)
  if (sellers.length === 0 && buyers.length === 0) return null

  const nodes: SankeyData['nodes'] = []
  const links: SankeyData['links'] = []
  for (const seller of sellers) nodes.push({ name: seller.label, side: 'seller', value: point[seller.key] })
  const marketIndex = nodes.length
  nodes.push({ name: marketLabel, side: 'market', value: 0 })
  sellers.forEach((seller, index) => links.push({ source: index, target: marketIndex, value: Math.abs(point[seller.key]) }))
  for (const buyer of buyers) {
    nodes.push({ name: buyer.label, side: 'buyer', value: point[buyer.key] })
    links.push({ source: marketIndex, target: nodes.length - 1, value: point[buyer.key] })
  }
  return { nodes, links }
}
