export interface TickData {
  symbol: string;
  category: string;
  price: number;
  changeRate: number;
  changePrice?: number;
  timestamp: number;      // 소스 기준 시각 (ms)
  volume?: number;
  collectedAt?: number;   // Worker가 외부 API 응답을 받은 시각 (ms)
  producedAt?: number;    // Worker가 Kafka로 전송한 시각 (ms)
}
