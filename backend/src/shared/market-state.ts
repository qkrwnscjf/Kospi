// 소스(Yahoo)가 알려 주는 장 상태 (docs/Task_ORDER.md T-56, D-40)
// 거래소 휴장일(공휴일)을 소스가 알고 있으므로, 시간표만으로는 알 수 없는 휴장을 이 값으로 판단한다.
export const MARKET_STATES = ['PREPRE', 'PRE', 'REGULAR', 'POST', 'POSTPOST', 'CLOSED'] as const;

export type MarketState = (typeof MARKET_STATES)[number];

const KNOWN_STATES = new Set<string>(MARKET_STATES);

export const isMarketState = (value: unknown): value is MarketState =>
  typeof value === 'string' && KNOWN_STATES.has(value);
