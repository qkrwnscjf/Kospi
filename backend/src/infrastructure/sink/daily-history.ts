// Yahoo 과거 일봉 → index_daily 행 (docs/Task_ORDER.md T-104 ③, D-67)
// 순수 함수만 둔다(테스트 대상). 받아 오기·저장은 backfill.ts의 runDailyHistoryBackfill이 한다.

import { closeTimestamp, shiftDate } from '../krx/krx-index-daily.js';

export interface DailyBar {
  time: Date;
  price: number;
  changeRate: number;
  changePrice: number;
}

export interface DailyRow {
  time: number; // ms
  close: number;
  changeRate: number;
  changePrice: number;
}

// 서울 기준 날짜(YYYYMMDD). 한국은 서머타임이 없어 +9시간 고정
const seoulDay = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10).replace(/-/g, '');

// - 기준 시각은 KRX 일별 값과 같은 규칙(그 거래일 15:30 KST)으로 맞춘다. 두 소스의 일별 값이 한 테이블에 같은 기준으로 쌓인다.
// - 시작한 지 24시간이 지나지 않은 봉은 아직 끝나지 않았을 수 있어(장중 값) 넣지 않는다. 시장마다 장 시간이 달라
//   "서울 기준 오늘"로 거르면 미국 장의 진행 중인 봉이 들어간다. 빠진 날은 실시간 집계가 만들거나 이음매 확인 때 다시 받는다.
// - 같은 날짜가 두 번 오면 마지막 값을 쓴다.
export function toDailyRows(bars: DailyBar[], nowMs: number): DailyRow[] {
  const byDay = new Map<string, DailyRow>();
  for (const bar of bars) {
    if (bar.time.getTime() > nowMs - 86_400_000) continue;
    const day = seoulDay(bar.time.getTime());
    byDay.set(day, { time: closeTimestamp(day), close: bar.price, changeRate: bar.changeRate, changePrice: bar.changePrice });
  }
  return [...byDay.values()].sort((a, b) => a.time - b.time);
}

// 두 날짜(YYYYMMDD) 사이(양 끝 제외)의 평일 수
function weekdaysBetween(from: string, to: string) {
  let count = 0;
  for (let day = shiftDate(from, 1); day < to; day = shiftDate(day, 1)) {
    const weekday = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)))).getUTCDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
  }
  return count;
}

// 집계가 시작된 뒤 이 기간까지만 이음매의 빈 날을 다시 확인한다 (공휴일 때문에 끝없이 다시 받지 않도록)
export const GAP_FILL_DAYS = 14;

// 과거 일봉을 (다시) 받아야 하는지. 빠진 것만 채운다(SEC-014와 같은 원칙).
// - 실시간 집계가 시작된 지 GAP_FILL_DAYS일이 지났으면 받지 않는다(Yahoo가 일봉을 주지 않는 지표도 여기서 멈춤).
// - 일봉이 아직 없거나 집계가 아직 없으면 받는다(그동안 거래일이 지나가면 이음매에 빈 날이 생김).
// - 둘 다 있으면, 마지막 일봉과 집계 첫날 사이에 평일이 남아 있을 때만 받는다.
//   예: Yahoo가 어제 일봉을 아직 확정하지 않았고, 어제 종가 tick은 집계 갱신 범위를 지나 집계에 들어가지 않은 경우.
export function needsDailyHistory(lastDailyMs: number | null, firstAggMs: number | null, nowMs: number): boolean {
  if (firstAggMs !== null && nowMs - firstAggMs > GAP_FILL_DAYS * 86_400_000) return false;
  if (lastDailyMs === null || firstAggMs === null) return true;
  return weekdaysBetween(seoulDay(lastDailyMs), seoulDay(firstAggMs)) > 0;
}
