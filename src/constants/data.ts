import { useMemo } from 'react'

export const generateMockData = (points = 30, base = 2500, volatility = 50) => {
  return Array.from({ length: points }, (_, i) => ({
    time: i,
    value: base + Math.sin(i * 0.5) * volatility + (Math.random() - 0.5) * volatility * 0.5,
  }))
}

export const CATEGORY_DATA: Record<string, { title: string; current: string; change: string; isUp: boolean; data: any[] }[]> = {
  category1: [
    { title: '코스피 지수', current: '2,623.29', change: '+1.23%', isUp: true, data: generateMockData(30, 2600, 40) },
    { title: '코스닥 지수', current: '845.44', change: '-0.45%', isUp: false, data: generateMockData(30, 850, 15) },
    { title: 'VKOSPI(공포지수)', current: '16.85', change: '-2.10%', isUp: false, data: generateMockData(30, 18, 2) },
    { title: '외인/기관 순매수', current: '1.2T', change: '+450B', isUp: true, data: generateMockData(30, 0, 500) },
  ],
  category2: [
    { title: '원/달러 환율', current: '1,372.50', change: '+0.12%', isUp: true, data: generateMockData(30, 1370, 10) },
    { title: '달러 인덱스', current: '104.85', change: '-0.05%', isUp: false, data: generateMockData(30, 105, 1) },
    { title: '미 국채 10년물', current: '4.45%', change: '+0.02%', isUp: true, data: generateMockData(30, 4.4, 0.1) },
    { title: '한 국고채 3년물', current: '3.38%', change: '-0.01%', isUp: false, data: generateMockData(30, 3.4, 0.05) },
  ],
  category3: [
    { title: 'S&P 500', current: '5,304.72', change: '+0.48%', isUp: true, data: generateMockData(30, 5200, 50) },
    { title: '나스닥 100', current: '18,808.35', change: '+0.65%', isUp: true, data: generateMockData(30, 18500, 200) },
    { title: '필라델피아 반도체', current: '5,100.00', change: '+1.15%', isUp: true, data: generateMockData(30, 5000, 80) },
    { title: 'WTI 원유 선물', current: '77.85', change: '-1.25%', isUp: false, data: generateMockData(30, 80, 2) },
  ],
  category4: [
    { title: 'KRX 반도체', current: '4,230', change: '+2.1%', isUp: true, data: generateMockData(20, 4100, 100) },
    { title: 'KRX 2차전지', current: '3,150', change: '-1.5%', isUp: false, data: generateMockData(20, 3200, 80) },
    { title: 'KRX 자동차', current: '2,890', change: '+0.8%', isUp: true, data: generateMockData(20, 2850, 40) },
    { title: 'KRX 헬스케어', current: '3,420', change: '-0.3%', isUp: false, data: generateMockData(20, 3450, 50) },
    { title: 'KOSPI 200 중공업', current: '1,560', change: '+1.2%', isUp: true, data: generateMockData(20, 1530, 30) },
    { title: 'KRX 인터넷', current: '2,100', change: '+0.5%', isUp: true, data: generateMockData(20, 2080, 20) },
    { title: 'KRX 은행', current: '1,850', change: '+1.8%', isUp: true, data: generateMockData(20, 1800, 30) },
  ],
}
