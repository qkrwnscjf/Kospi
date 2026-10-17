// Yahoo 심볼 표와 카테고리 표 (docs/Task_ORDER.md T-22)
// 이전에는 yahoo-api.ts와 history.controller.ts에 따로 정의되어 있었다 (P-17).
// 실시간 수집, 과거 데이터 채우기, History API가 모두 이 표를 쓴다.

export const YAHOO_SYMBOLS = {
  // Domestic
  KOSPI: '^KS11',
  KOSDAQ: '^KQ11',
  // Macro
  'USD/KRW': 'KRW=X',
  DXY: 'DX-Y.NYB',
  'US10Y': '^TNX', // 미 10년물 금리
  // Global
  SP500: '^GSPC',
  NASDAQ: '^NDX',
  SOX: '^SOX', // 필라델피아 반도체
  WTI: 'CL=F', // 원유
  COPPER: 'HG=F' // 구리
} as const;

export type YahooSymbolKey = keyof typeof YAHOO_SYMBOLS;

export const YAHOO_CATEGORY: Record<YahooSymbolKey, 'domestic' | 'macro' | 'global'> = {
  KOSPI: 'domestic',
  KOSDAQ: 'domestic',
  'USD/KRW': 'macro',
  DXY: 'macro',
  'US10Y': 'macro',
  SP500: 'global',
  NASDAQ: 'global',
  SOX: 'global',
  WTI: 'global',
  COPPER: 'global'
};

export const YAHOO_KEYS = Object.keys(YAHOO_SYMBOLS) as YahooSymbolKey[];

export const isYahooSymbolKey = (value: string): value is YahooSymbolKey =>
  Object.prototype.hasOwnProperty.call(YAHOO_SYMBOLS, value);

// Naver 6종의 내부 심볼 (수집은 보류 중, R-03). 제공처 심볼 표는 naver-api.ts에 있다.
export const NAVER_KEYS = ['VKOSPI', 'KRX_SEMI', 'KRX_IT', 'KRX_AUTO', 'KRX_BANK', 'KRX_BIO'] as const;

// 브라우저가 구독할 수 있는 심볼 (docs/security.md SEC-005). 이 목록에 없는 값으로는 방(room)을 만들지 않는다.
const SUBSCRIBABLE_SYMBOLS = new Set<string>([...YAHOO_KEYS, ...NAVER_KEYS]);

export const isSubscribableSymbol = (value: unknown): value is string =>
  typeof value === 'string' && SUBSCRIBABLE_SYMBOLS.has(value);
