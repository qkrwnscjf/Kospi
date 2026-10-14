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

// 측정 지표 (docs/Task_ORDER.md T-30). 라벨에는 내부 심볼만 넣는다.
const symbolAliasTotal = new Counter('kospi_worker_symbol_alias_total', 'Yahoo responses whose symbol was an alias, by internal symbol');
const unmappedSymbolTotal = new Counter('kospi_worker_unmapped_symbol_total', 'Yahoo quotes dropped because the symbol could not be mapped');

export async function fetchYahooData(): Promise<NormalizedMarketData[]> {
  try {
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

      results.push({
        ticker: key,
        category: CATEGORY_BY_KEY[key],
        price: quote.regularMarketPrice || 0,
        changeRate: quote.regularMarketChangePercent || 0,
        changePrice: quote.regularMarketChange || 0,
        timestamp: quote.regularMarketTime?.getTime() || Date.now(),
        ...(quote.regularMarketVolume !== undefined ? { volume: quote.regularMarketVolume } : {}),
      });
    }

    return results;
  } catch (error) {
    console.error('Error fetching Yahoo Finance data:', error);
    return [];
  }
}
