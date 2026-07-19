import YahooFinance from 'yahoo-finance2';
import type { NormalizedMarketData } from './normalizer.js';

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

function getCategory(key: YahooSymbolKey): NormalizedMarketData['category'] {
  if (['KOSPI', 'KOSDAQ'].includes(key)) return 'domestic';
  if (['USD/KRW', 'DXY', 'US10Y'].includes(key)) return 'macro';
  return 'global';
}

export async function fetchYahooData(): Promise<NormalizedMarketData[]> {
  try {
    const keys = Object.keys(YAHOO_SYMBOLS) as YahooSymbolKey[];
    const symbols = keys.map(k => YAHOO_SYMBOLS[k]);
    
    // yahoo-finance2 supports fetching multiple quotes at once
    const quotes = await yahooFinance.quote(symbols);
    
    return quotes.map(quote => {
      // Find the original key for the symbol
      const key = keys.find(k => YAHOO_SYMBOLS[k] === quote.symbol) || quote.symbol;
      const category = getCategory(key as YahooSymbolKey);
      
      return {
        ticker: key,
        category,
        price: quote.regularMarketPrice || 0,
        changeRate: quote.regularMarketChangePercent || 0,
        changePrice: quote.regularMarketChange || 0,
        timestamp: quote.regularMarketTime?.getTime() || Date.now(),
        volume: quote.regularMarketVolume,
      };
    });
  } catch (error) {
    console.error('Error fetching Yahoo Finance data:', error);
    return [];
  }
}
