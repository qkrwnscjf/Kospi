import { useMemo } from 'react'

export const generateMockData = (points = 30, base = 2500, volatility = 50) => {
  const now = Date.now();
  return Array.from({ length: points }, (_, i) => ({
    time: now - ((points - i - 1) * 1000), // 1 second intervals backwards from now
    value: base + Math.sin(i * 0.5) * volatility + (Math.random() - 0.5) * volatility * 0.5,
  }))
}

export const CATEGORY_DATA: Record<string, { title: string; symbol?: string; current: string; change: string; isUp: boolean; data: any[] }[]> = {
  category1: [
    { title: '코스피 지수', symbol: 'KOSPI', current: '...', change: '...', isUp: true, data: generateMockData() },
    { title: '코스닥 지수', symbol: 'KOSDAQ', current: '...', change: '...', isUp: false, data: generateMockData() },
    { title: '코스피200 변동성지수', symbol: 'VKOSPI', current: '...', change: '...', isUp: false, data: generateMockData() },
  ],
  category2: [
    { title: '원/달러 환율', symbol: 'USD/KRW', current: '...', change: '...', isUp: true, data: generateMockData() },
    { title: '달러 인덱스', symbol: 'DXY', current: '...', change: '...', isUp: false, data: generateMockData() },
    { title: '미 국채 10년물', symbol: 'US10Y', current: '...', change: '...', isUp: true, data: generateMockData() },
  ],
  category3: [
    { title: 'S&P 500', symbol: 'SP500', current: '...', change: '...', isUp: true, data: generateMockData() },
    { title: '나스닥 100', symbol: 'NASDAQ', current: '...', change: '...', isUp: true, data: generateMockData() },
    { title: '필라델피아 반도체', symbol: 'SOX', current: '...', change: '...', isUp: true, data: generateMockData() },
    { title: 'WTI 원유 선물', symbol: 'WTI', current: '...', change: '...', isUp: false, data: generateMockData() },
    { title: '구리 선물', symbol: 'COPPER', current: '...', change: '...', isUp: true, data: generateMockData() },
  ],
  category4: [
    { title: 'KRX 반도체', symbol: 'KRX_SEMI', current: '...', change: '...', isUp: true, data: generateMockData() },
    { title: 'KRX 정보기술(IT)', symbol: 'KRX_IT', current: '...', change: '...', isUp: true, data: generateMockData() },
    { title: 'KRX 자동차', symbol: 'KRX_AUTO', current: '...', change: '...', isUp: true, data: generateMockData() },
    { title: 'KRX 은행', symbol: 'KRX_BANK', current: '...', change: '...', isUp: false, data: generateMockData() },
    { title: 'KRX 헬스케어', symbol: 'KRX_BIO', current: '...', change: '...', isUp: true, data: generateMockData() },
  ],
}
