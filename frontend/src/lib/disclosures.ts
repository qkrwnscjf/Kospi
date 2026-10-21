// 공시·자본 이벤트 표시 (docs/Task_ORDER.md 12단계 T-78)
// 테스트할 수 있도록 React와 분리한 순수 함수다. 다른 모듈을 import하지 않는다.

export interface DisclosureItem {
  rceptNo: string
  rceptDate: string
  stockCode: string
  corpName: string
  reportName: string
  group: string
  kind: string
  isCorrection: boolean
  amount: number | null
}

export const GROUPS: { key: string; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'dilution', label: '희석' },
  { key: 'shareholder_return', label: '주주환원' },
  { key: 'treasury_disposal', label: '자사주 처분' },
  { key: 'earnings', label: '실적' },
  { key: 'ownership', label: '지분' },
  { key: 'other', label: '기타' },
]

export const groupLabel = (group: string) => GROUPS.find(item => item.key === group)?.label ?? '기타'

const KIND_LABELS: Record<string, string> = {
  rights_offering: '유상증자',
  cb: '전환사채',
  bw: '신주인수권부사채',
  eb: '교환사채',
  buyback: '자사주 취득',
  buyback_trust: '자사주 신탁',
  cancellation: '주식 소각',
  disposal: '자사주 처분',
}
export const kindLabel = (kind: string) => KIND_LABELS[kind] ?? null

// 원 → 억원·조원 표시. 금액이 없으면(null) "금액 없음" (0으로 표시하지 않음, D-59 ④)
export function formatKrw(amount: number | null) {
  if (amount === null) return '금액 없음'
  const eok = amount / 100_000_000
  if (Math.abs(eok) >= 10_000) return `${(eok / 10_000).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}조원`
  if (Math.abs(eok) >= 1) return `${Math.round(eok).toLocaleString('ko-KR')}억원`
  if (amount === 0) return '0원'
  return `${(eok).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}억원`
}

// 원 → 억원 (차트 축)
export const toEokWon = (amount: number) => amount / 100_000_000

// 새 공시를 목록에 합친다: 접수번호로 중복 제거, 최신순, 최대 개수 유지
export function mergeDisclosures(list: DisclosureItem[], incoming: DisclosureItem[], max = 100) {
  const byNo = new Map(list.map(item => [item.rceptNo, item]))
  for (const item of incoming) byNo.set(item.rceptNo, item)
  return [...byNo.values()].sort((a, b) => b.rceptNo.localeCompare(a.rceptNo)).slice(0, max)
}

// DART 원문 보기 주소. 접수번호가 숫자 14자리일 때만 만든다 (임의 값이 주소에 들어가지 않게)
export function dartViewerUrl(rceptNo: string) {
  return /^\d{14}$/.test(rceptNo) ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rceptNo}` : null
}

// 공시가 "오늘(서울)" 접수인지
export function seoulToday(nowMs = Date.now()) {
  return new Date(nowMs + 9 * 3600_000).toISOString().slice(0, 10)
}
