import { FastifyInstance } from 'fastify';

export const historyController = async (fastify: FastifyInstance) => {
  fastify.get('/api/v1/market/history', async (request, reply) => {
    const { ticker, timeframe } = request.query as { ticker: string, timeframe: string };
    
    // 타임프레임별 가상 시계열 데이터 생성
    let points = 30;
    let base = 2500;
    let volatility = 50;
    let intervalMs = 60000; 
    
    if (ticker === 'KOSDAQ') base = 850;
    if (ticker === 'USD_KRW') base = 1370;
    if (ticker === 'SP500') base = 5200;

    const now = Date.now();

    if (timeframe === '1일') { points = 60; intervalMs = 1000 * 60 * 5; volatility = 20; } 
    else if (timeframe === '1주') { points = 35; intervalMs = 1000 * 60 * 60 * 4; volatility = 60; } 
    else if (timeframe === '1개월') { points = 30; intervalMs = 1000 * 60 * 60 * 24; volatility = 100; } 
    else if (timeframe === '3개월') { points = 90; intervalMs = 1000 * 60 * 60 * 24; volatility = 150; } 
    else if (timeframe === '1년') { points = 52; intervalMs = 1000 * 60 * 60 * 24 * 7; volatility = 300; } 

    const data = Array.from({ length: points }, (_, i) => {
      const time = now - ((points - i - 1) * intervalMs);
      const value = base + Math.sin(i * 0.5) * volatility + (Math.random() - 0.5) * volatility * 0.5;
      return { time, value: parseFloat(value.toFixed(2)) };
    });

    return {
      ticker,
      timeframe,
      data
    };
  });
};
