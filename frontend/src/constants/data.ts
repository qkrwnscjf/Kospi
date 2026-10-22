import type { MarketId } from '@/lib/marketHours'

// 카드 목록. 첫 화면은 mock 데이터 없이 실제 값(최근 tick, 캐시된 최신값)으로 채운다 (docs/Task_ORDER.md T-25, P-02).
// ready: false인 지표는 수집이 보류 중이라(R-03) "데이터 준비 중"으로 표시하고, 서버에 요청하지 않는다 (T-26, R-04).
//
// 표시 설정 (T-41, T-42)
// - decimals: 현재가 소수 자릿수. 축 눈금도 이 자릿수까지만 쓴다.
// - prefix / suffix: 단위
// - market: 장 상태(장중 / 장 마감)를 판단할 시장 (lib/marketHours.ts)
// - delayMinutes: 소스가 지연 시세를 주는 지표 (BENCHMARK B-02 실측: DXY·WTI·구리 약 10분, US10Y 약 15분)
// - daily: 하루 1개 값(종가)만 있는 지표. KRX Open API 일별 시세 (T-67). 실시간·1일 그래프 없이 1주 ~ 1년만 보여 준다.

export interface ChartCardConfig {
  title: string
  symbol: string
  ready: boolean
  decimals: number
  prefix?: string
  suffix?: string
  market?: MarketId
  delayMinutes?: number
  daily?: boolean
}

export const CATEGORY_DATA: Record<string, ChartCardConfig[]> = {
  category1: [
    { title: '코스피 지수', symbol: 'KOSPI', ready: true, decimals: 2, suffix: 'pt', market: 'krx' },
    { title: '코스닥 지수', symbol: 'KOSDAQ', ready: true, decimals: 2, suffix: 'pt', market: 'krx' },
    { title: '코스피200 변동성지수', symbol: 'VKOSPI', ready: true, decimals: 2, daily: true },
  ],
  category2: [
    { title: '원/달러 환율', symbol: 'USD/KRW', ready: true, decimals: 2, suffix: '원', market: 'global_24h' },
    { title: '달러 인덱스', symbol: 'DXY', ready: true, decimals: 2, suffix: 'pt', market: 'global_24h', delayMinutes: 10 },
    { title: '미 국채 10년물', symbol: 'US10Y', ready: true, decimals: 3, suffix: '%', market: 'us_equity', delayMinutes: 15 },
  ],
  category3: [
    { title: 'S&P 500', symbol: 'SP500', ready: true, decimals: 2, suffix: 'pt', market: 'us_equity' },
    { title: '나스닥 100', symbol: 'NASDAQ', ready: true, decimals: 2, suffix: 'pt', market: 'us_equity' },
    { title: '필라델피아 반도체', symbol: 'SOX', ready: true, decimals: 2, suffix: 'pt', market: 'us_equity' },
    { title: 'WTI 원유 선물', symbol: 'WTI', ready: true, decimals: 2, prefix: '$', market: 'global_24h', delayMinutes: 10 },
    { title: '구리 선물', symbol: 'COPPER', ready: true, decimals: 4, prefix: '$', market: 'global_24h', delayMinutes: 10 },
  ],
  category4: [
    { title: 'KRX 반도체', symbol: 'KRX_SEMI', ready: true, decimals: 2, suffix: 'pt', daily: true },
    { title: 'KRX 정보기술(IT)', symbol: 'KRX_IT', ready: true, decimals: 2, suffix: 'pt', daily: true },
    { title: 'KRX 자동차', symbol: 'KRX_AUTO', ready: true, decimals: 2, suffix: 'pt', daily: true },
    { title: 'KRX 은행', symbol: 'KRX_BANK', ready: true, decimals: 2, suffix: 'pt', daily: true },
    { title: 'KRX 헬스케어', symbol: 'KRX_BIO', ready: true, decimals: 2, suffix: 'pt', daily: true },
    // 섹터 확장 (D-66): KRX 섹터 지수 12종 (일별 시세)
    { title: 'KRX 에너지화학', symbol: 'KRX_ENERGY_CHEM', ready: true, decimals: 2, suffix: 'pt', daily: true },
    { title: 'KRX 철강', symbol: 'KRX_STEEL', ready: true, decimals: 2, suffix: 'pt', daily: true },
    { title: 'KRX 방송통신', symbol: 'KRX_TELECOM', ready: true, decimals: 2, suffix: 'pt', daily: true },
    { title: 'KRX 건설', symbol: 'KRX_CONSTRUCTION', ready: true, decimals: 2, suffix: 'pt', daily: true },
    { title: 'KRX 증권', symbol: 'KRX_SECURITIES', ready: true, decimals: 2, suffix: 'pt', daily: true },
    { title: 'KRX 기계장비', symbol: 'KRX_MACHINERY', ready: true, decimals: 2, suffix: 'pt', daily: true },
    { title: 'KRX 보험', symbol: 'KRX_INSURANCE', ready: true, decimals: 2, suffix: 'pt', daily: true },
    { title: 'KRX 운송', symbol: 'KRX_TRANSPORT', ready: true, decimals: 2, suffix: 'pt', daily: true },
    { title: 'KRX 경기소비재', symbol: 'KRX_CONS_DISC', ready: true, decimals: 2, suffix: 'pt', daily: true },
    { title: 'KRX 필수소비재', symbol: 'KRX_CONS_STAPLES', ready: true, decimals: 2, suffix: 'pt', daily: true },
    { title: 'KRX K콘텐츠', symbol: 'KRX_KCONTENT', ready: true, decimals: 2, suffix: 'pt', daily: true },
    { title: 'KRX 유틸리티', symbol: 'KRX_UTILITIES', ready: true, decimals: 2, suffix: 'pt', daily: true },
  ],
}
