// 카드 목록. 첫 화면은 mock 데이터 없이 실제 값(최근 tick, 캐시된 최신값)으로 채운다 (docs/Task_ORDER.md T-25, P-02).
// ready: false인 지표는 수집이 보류 중이라(R-03) "데이터 준비 중"으로 표시하고, 서버에 요청하지 않는다 (T-26, R-04).

export interface ChartCardConfig {
  title: string
  symbol: string
  ready: boolean
}

export const CATEGORY_DATA: Record<string, ChartCardConfig[]> = {
  category1: [
    { title: '코스피 지수', symbol: 'KOSPI', ready: true },
    { title: '코스닥 지수', symbol: 'KOSDAQ', ready: true },
    { title: '코스피200 변동성지수', symbol: 'VKOSPI', ready: false },
  ],
  category2: [
    { title: '원/달러 환율', symbol: 'USD/KRW', ready: true },
    { title: '달러 인덱스', symbol: 'DXY', ready: true },
    { title: '미 국채 10년물', symbol: 'US10Y', ready: true },
  ],
  category3: [
    { title: 'S&P 500', symbol: 'SP500', ready: true },
    { title: '나스닥 100', symbol: 'NASDAQ', ready: true },
    { title: '필라델피아 반도체', symbol: 'SOX', ready: true },
    { title: 'WTI 원유 선물', symbol: 'WTI', ready: true },
    { title: '구리 선물', symbol: 'COPPER', ready: true },
  ],
  category4: [
    { title: 'KRX 반도체', symbol: 'KRX_SEMI', ready: false },
    { title: 'KRX 정보기술(IT)', symbol: 'KRX_IT', ready: false },
    { title: 'KRX 자동차', symbol: 'KRX_AUTO', ready: false },
    { title: 'KRX 은행', symbol: 'KRX_BANK', ready: false },
    { title: 'KRX 헬스케어', symbol: 'KRX_BIO', ready: false },
  ],
}
