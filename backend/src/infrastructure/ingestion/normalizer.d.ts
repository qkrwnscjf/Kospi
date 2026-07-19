export interface NormalizedMarketData {
    ticker: string;
    category: 'domestic' | 'macro' | 'global' | 'sector';
    price: number;
    changeRate: number;
    changePrice?: number;
    timestamp: number;
    volume?: number;
}
export declare function normalizeData(data: NormalizedMarketData): NormalizedMarketData;
//# sourceMappingURL=normalizer.d.ts.map