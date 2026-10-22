// 두 지표의 차이를 보여 주는 카드 (docs/Task_ORDER.md T-107, 미 장단기 금리차 = 10년물 − 13주)
// 서버에 저장하지 않고, 두 지표의 최신 tick으로 화면에서 계산한다. 과거 그래프는 History API가 같은 방식으로 계산한다.
// 테스트할 수 있도록 React와 분리한 순수 함수다. 다른 모듈을 import하지 않는다.

export interface SpreadSource {
  price: number
  changePrice?: number
  timestamp: number
}

export interface SpreadValue {
  price: number
  changePrice?: number
  timestamp: number
}

const round = (value: number) => Math.round(value * 10000) / 10000

// - 현재값: long − short
// - 전일 대비: 두 지표의 전일 대비 변화량 차이(%p). 한쪽이라도 없으면 계산하지 않는다(0으로 채우지 않음)
// - 기준 시각: 두 tick 중 더 오래된 시각(그 뒤로는 두 값이 함께 확인되지 않았으므로)
export function spreadValue(long: SpreadSource, short: SpreadSource): SpreadValue {
  const value: SpreadValue = { price: round(long.price - short.price), timestamp: Math.min(long.timestamp, short.timestamp) }
  if (long.changePrice !== undefined && short.changePrice !== undefined) {
    value.changePrice = round(long.changePrice - short.changePrice)
  }
  return value
}
