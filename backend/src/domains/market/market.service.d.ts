import type { TickData } from '../../shared/types.js';
export declare class MarketService {
    saveLatestTick(tick: TickData): Promise<void>;
    getLatestTick(symbol: string): Promise<TickData | null>;
}
export declare const marketService: MarketService;
//# sourceMappingURL=market.service.d.ts.map