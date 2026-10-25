// KRX 종목별 일별 매매정보 → 시장 폭·거래대금 요약 (docs/Task_ORDER.md T-106, D-67)
// 순수 함수만 둔다(테스트 대상). 종목 행은 이 함수 밖으로 나가지 않는다(합계만 Kafka로 보냄).
//
// 응답 필드 (T-93에서 코스닥 응답으로 확인한 15개 항목: 기준일·종목코드·종목명·시장·소속부·종가·대비·등락률·시가·고가·저가·
// 거래량·거래대금·시가총액·상장주식수). 영문 이름은 KRX Open API의 알려진 형식이며, 첫 응답에서 필드 이름(값 제외)을 한 번 기록해 확인한다.

import type { BreadthMarket, MarketBreadth } from '../../shared/breadth.js';
import { closeTimestamp, parseKrxNumber } from './krx-index-daily.js';

export type BreadthEndpoint = 'stk' | 'ksq';

// stk = 유가증권 일별매매정보, ksq = 코스닥 일별매매정보 (같은 KRX 키 + 서비스별 이용 신청)
export const BREADTH_ENDPOINTS: Record<BreadthEndpoint, { path: string; market: BreadthMarket }> = {
  stk: { path: '/sto/stk_bydd_trd', market: 'KOSPI' },
  ksq: { path: '/sto/ksq_bydd_trd', market: 'KOSDAQ' },
};

export const STOCK_FIELDS = {
  close: 'TDD_CLSPRC',      // 종가
  change: 'CMPPREVDD_PRC',  // 대비
  changeRate: 'FLUC_RT',    // 등락률
  value: 'ACC_TRDVAL',      // 거래대금 (원)
} as const;

const sign = (value: number) => (value > 0 ? 1 : value < 0 ? -1 : 0);

// 등락 방향: 등락률(부호 있음)을 먼저 쓴다. 등락률이 0.00으로 반올림됐거나 없으면, 응답의 대비 값에 음수가 하나라도 있을 때만
// (= 대비가 부호를 가진 형식일 때만) 대비의 부호를 쓴다. 대비에 부호가 없는 형식이면 방향을 알 수 없어 보합으로 본다.
export function summarizeBreadth(market: BreadthMarket, basDd: string, rows: Record<string, unknown>[]): { breadth: MarketBreadth | null; invalid: number } {
  const changeSigned = rows.some(row => (parseKrxNumber(row[STOCK_FIELDS.change]) ?? 0) < 0);
  let advancers = 0;
  let decliners = 0;
  let unchanged = 0;
  let tradingValue = 0;
  let invalid = 0;

  for (const row of rows) {
    const close = parseKrxNumber(row[STOCK_FIELDS.close]);
    const rate = parseKrxNumber(row[STOCK_FIELDS.changeRate]);
    const change = parseKrxNumber(row[STOCK_FIELDS.change]);
    const value = parseKrxNumber(row[STOCK_FIELDS.value]);
    // 값이 하나라도 없으면 0으로 채우지 않고 그 종목을 합계에서 뺀다 (D-14와 같은 원칙)
    if (close === null || close <= 0 || value === null || value < 0 || (rate === null && change === null)) {
      invalid += 1;
      continue;
    }
    const direction = rate !== null && rate !== 0 ? sign(rate) : changeSigned && change !== null ? sign(change) : 0;
    if (direction > 0) advancers += 1;
    else if (direction < 0) decliners += 1;
    else unchanged += 1;
    tradingValue += value;
  }

  const stocks = advancers + decliners + unchanged;
  if (stocks === 0) return { breadth: null, invalid };
  return { breadth: { market, time: closeTimestamp(basDd), advancers, decliners, unchanged, stocks, tradingValue }, invalid };
}
