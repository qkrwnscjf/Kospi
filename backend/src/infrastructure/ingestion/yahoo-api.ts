import YahooFinance from 'yahoo-finance2';
import type { NormalizedMarketData } from './normalizer.js';
import { Counter } from '../metrics.js';

const yahooFinance = new YahooFinance();

const YAHOO_SYMBOLS = {
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

type YahooSymbolKey = keyof typeof YAHOO_SYMBOLS;

const CATEGORY_BY_KEY: Record<YahooSymbolKey, NormalizedMarketData['category']> = {
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

// Yahoo가 응답의 symbol을 요청과 다른 표기로 돌려주는 경우 (docs/pipeline.md P-23)
const YAHOO_SYMBOL_ALIASES: Record<string, string> = {
  'USDKRW=X': 'KRW=X'
};

const KEY_BY_YAHOO_SYMBOL = new Map<string, YahooSymbolKey>(
  (Object.keys(YAHOO_SYMBOLS) as YahooSymbolKey[]).map(key => [YAHOO_SYMBOLS[key], key])
);

// 측정 지표 (docs/Task_ORDER.md T-30, T-05). 라벨에는 내부 심볼과 고정된 사유만 넣는다.
const symbolAliasTotal = new Counter('kospi_worker_symbol_alias_total', 'Yahoo responses whose symbol was an alias, by internal symbol');
const unmappedSymbolTotal = new Counter('kospi_worker_unmapped_symbol_total', 'Yahoo quotes dropped because the symbol could not be mapped');
const invalidQuoteTotal = new Counter('kospi_worker_invalid_quote_total', 'Yahoo quotes dropped by validation, by symbol and reason');

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

// 값 검증 (docs/Task_ORDER.md T-05, D-14)
// 이전에는 값이 없으면 0이나 수집 시각으로 대체해서, "값 없음"이 정상값처럼 저장되었다.
// 이제는 버리고 사유를 센다. 등락률·등락폭의 0은 실제로 나올 수 있는 정상값이라 허용한다.
type ValidatedQuote = { price: number; time: Date; changeRate: number; changePrice: number };

function validateQuote(
  price: unknown,
  time: unknown,
  changeRate: unknown,
  changePrice: unknown
): ValidatedQuote | { reason: string } {
  if (!isFiniteNumber(price) || price <= 0) return { reason: 'price' };
  if (!(time instanceof Date) || Number.isNaN(time.getTime())) return { reason: 'timestamp' };
  if (!isFiniteNumber(changeRate)) return { reason: 'change_rate' };
  if (!isFiniteNumber(changePrice)) return { reason: 'change_price' };
  return { price, time, changeRate, changePrice };
}

// 요청 실패는 삼키지 않고 던진다. worker가 result="error"로 집계하고 백오프한다 (docs/Task_ORDER.md T-05).
export async function fetchYahooData(): Promise<NormalizedMarketData[]> {
  const symbols = Object.values(YAHOO_SYMBOLS);

  // yahoo-finance2 supports fetching multiple quotes at once
  const quotes = await yahooFinance.quote(symbols);

  const results: NormalizedMarketData[] = [];
  const seen = new Set<YahooSymbolKey>();

  for (const quote of quotes) {
    const canonicalSymbol = YAHOO_SYMBOL_ALIASES[quote.symbol] ?? quote.symbol;
    const key = KEY_BY_YAHOO_SYMBOL.get(canonicalSymbol);

    // 매핑할 수 없는 심볼은 그대로 쓰지 않고 버린다. 잘못된 심볼이 Kafka와 DB에 들어가지 않게 하기 위함.
    if (!key) {
      unmappedSymbolTotal.inc();
      console.warn(`Unmapped Yahoo symbol skipped: ${quote.symbol}`);
      continue;
    }
    if (canonicalSymbol !== quote.symbol) {
      symbolAliasTotal.inc({ symbol: key });
    }
    // 같은 응답에 표준 심볼과 별칭이 함께 오면 먼저 온 하나만 쓴다.
    if (seen.has(key)) continue;
    seen.add(key);

    const validated = validateQuote(
      quote.regularMarketPrice,
      quote.regularMarketTime,
      quote.regularMarketChangePercent,
      quote.regularMarketChange
    );
    if ('reason' in validated) {
      invalidQuoteTotal.inc({ symbol: key, reason: validated.reason });
      console.warn(`Invalid Yahoo quote skipped: ${key} (${validated.reason})`);
      continue;
    }

    results.push({
      ticker: key,
      category: CATEGORY_BY_KEY[key],
      price: validated.price,
      changeRate: validated.changeRate,
      changePrice: validated.changePrice,
      timestamp: validated.time.getTime(),
      ...(isFiniteNumber(quote.regularMarketVolume) ? { volume: quote.regularMarketVolume } : {}),
    });
  }

  return results;
}
