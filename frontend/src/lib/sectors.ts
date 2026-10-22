// 섹터 수익률 노드 계산 (docs/Task_ORDER.md D-66)
// 테스트할 수 있도록 React와 분리한 순수 함수다. 다른 모듈을 import하지 않는다.

export interface SectorReturn {
  symbol: string
  returnPct: number | null // 기간 첫 종가 대비 마지막 종가(%). 점이 2개 미만이면 null
  last: number
  dayChangeRate: number
  lastTime: number
  points: number
}

// 노드에 쓰는 짧은 이름 (카드 제목은 constants/data.ts)
export const SECTOR_LABELS: Record<string, string> = {
  KRX_SEMI: '반도체',
  KRX_IT: '정보기술',
  KRX_AUTO: '자동차',
  KRX_BANK: '은행',
  KRX_BIO: '헬스케어',
  KRX_ENERGY_CHEM: '에너지화학',
  KRX_STEEL: '철강',
  KRX_TELECOM: '방송통신',
  KRX_CONSTRUCTION: '건설',
  KRX_SECURITIES: '증권',
  KRX_MACHINERY: '기계장비',
  KRX_INSURANCE: '보험',
  KRX_TRANSPORT: '운송',
  KRX_CONS_DISC: '경기소비재',
  KRX_CONS_STAPLES: '필수소비재',
  KRX_KCONTENT: 'K콘텐츠',
  KRX_UTILITIES: '유틸리티',
}

// 수익률 높은 순. 계산할 수 없는 섹터(null)는 맨 뒤
export function rankSectors(sectors: SectorReturn[]) {
  return [...sectors].sort((a, b) => {
    if (a.returnPct === null && b.returnPct === null) return a.symbol.localeCompare(b.symbol)
    if (a.returnPct === null) return 1
    if (b.returnPct === null) return -1
    return b.returnPct - a.returnPct
  })
}

// 등락 방향 (색은 미국식: 상승 초록, 하락 빨강, D-32). 0.05% 미만은 보합
export function returnDirection(returnPct: number | null): 'up' | 'down' | 'flat' | 'none' {
  if (returnPct === null) return 'none'
  if (returnPct >= 0.05) return 'up'
  if (returnPct <= -0.05) return 'down'
  return 'flat'
}

// 색의 진하기: 기간 안 최대 절댓값 대비 비율(0.25 ~ 1). 노드끼리 크기를 비교하기 쉽게
export function returnIntensity(returnPct: number | null, maxAbs: number) {
  if (returnPct === null || maxAbs <= 0) return 0.25
  return Math.max(0.25, Math.min(1, Math.abs(returnPct) / maxAbs))
}

export function formatReturn(returnPct: number | null) {
  if (returnPct === null) return '—'
  const sign = returnPct > 0 ? '+' : ''
  return `${sign}${returnPct.toFixed(2)}%`
}
