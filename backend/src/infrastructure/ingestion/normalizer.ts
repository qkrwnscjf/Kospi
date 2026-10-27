import type { MarketState } from '../../shared/market-state.js';

export interface NormalizedMarketData {
  ticker: string;          // e.g., 'KOSPI', 'USD/KRW', 'KRX_SEMI'
  category: 'domestic' | 'macro' | 'global' | 'sector';
  price: number;
  changeRate: number;      // percentage (e.g., 1.25 for +1.25%)
  changePrice?: number;    // absolute change
  timestamp: number;       // Unix timestamp in ms
  volume?: number;
  marketState?: MarketState; // 소스의 장 상태 (T-56). 없으면 시간표로만 판단한다
}
