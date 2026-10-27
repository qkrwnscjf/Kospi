// 나중에 추가한 Yahoo 지표의 과거 일봉 테스트 (docs/Task_ORDER.md T-104 ③, D-67)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAP_FILL_DAYS, missingWeekdays, needsDailyHistory, toDailyRows } from '../src/infrastructure/sink/daily-history.js';
import { closeTimestamp } from '../src/infrastructure/krx/krx-index-daily.js';

const bar = (iso: string, price: number) => ({ time: new Date(iso), price, changeRate: 1, changePrice: 2 });

test('일봉 시각은 서울 거래일의 15:30 KST(KRX 일별 값과 같은 기준)로 맞춘다', () => {
  // Yahoo 일봉 시각이 서울 자정(전날 15:00 UTC)이든 개장 시각(00:00 UTC)이든 같은 거래일로 본다
  const rows = toDailyRows([bar('2026-10-19T15:00:00Z', 100), bar('2026-10-21T00:00:00Z', 101)], Date.parse('2026-10-23T03:00:00Z'));
  assert.deepEqual(rows.map(row => row.time), [closeTimestamp('20261020'), closeTimestamp('20261021')]);
  assert.equal(rows[0]?.close, 100);
});

test('시작한 지 24시간이 안 된 봉은 장중 값일 수 있어 넣지 않는다', () => {
  const now = Date.parse('2026-10-23T03:00:00Z'); // 금 12:00 KST
  const rows = toDailyRows([bar('2026-10-22T00:00:00Z', 100), bar('2026-10-23T00:00:00Z', 105)], now);
  assert.deepEqual(rows.map(row => row.time), [closeTimestamp('20261022')]);
});

test('서울 날짜가 지났어도 미국 장의 진행 중인 봉은 넣지 않는다', () => {
  const now = Date.parse('2026-10-22T16:40:00Z'); // 금 01:40 KST, 미국 목요일 장중
  const rows = toDailyRows([bar('2026-10-21T13:30:00Z', 100), bar('2026-10-22T13:30:00Z', 101)], now);
  assert.deepEqual(rows.map(row => row.close), [100]);
});

test('needsDailyHistory: 일봉이나 집계가 없으면 받는다', () => {
  const now = Date.parse('2026-10-23T03:00:00Z');
  assert.equal(needsDailyHistory(null, null, now), true);
  assert.equal(needsDailyHistory(closeTimestamp('20261021'), null, now), true);
  assert.equal(needsDailyHistory(null, Date.parse('2026-10-23T00:00:00Z'), now), true);
});

test('needsDailyHistory: 마지막 일봉과 집계 첫날 사이에 평일이 비어 있을 때만 다시 받는다 (이음매)', () => {
  const now = Date.parse('2026-10-23T03:00:00Z');
  const firstAgg = Date.parse('2026-10-23T00:00:00Z'); // 금요일 집계 시작
  assert.equal(needsDailyHistory(closeTimestamp('20261021'), firstAgg, now), true);  // 목(10/22)이 빔
  assert.equal(needsDailyHistory(closeTimestamp('20261022'), firstAgg, now), false); // 이어짐
  // 금요일 일봉 → 월요일 집계 시작: 사이가 주말뿐이라 받지 않음
  assert.equal(needsDailyHistory(closeTimestamp('20261023'), Date.parse('2026-10-26T00:00:00Z'), Date.parse('2026-10-26T03:00:00Z')), false);
});

test(`needsDailyHistory: 집계가 시작된 지 ${GAP_FILL_DAYS}일이 지나면 더 받지 않는다 (공휴일·일봉 없는 지표)`, () => {
  const firstAgg = Date.parse('2026-10-01T00:00:00Z');
  const later = firstAgg + (GAP_FILL_DAYS + 1) * 86_400_000;
  assert.equal(needsDailyHistory(null, firstAgg, later), false);
  assert.equal(needsDailyHistory(closeTimestamp('20260925'), firstAgg, later), false);
});

test('missingWeekdays: 집계·일봉 모두에 없는 평일만, 주말·최근 이틀·집계 시작 전은 빼고 (T-127)', () => {
  const now = Date.parse('2026-10-27T03:00:00Z'); // 화요일
  const agg = ['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-19', '2026-10-21', '2026-10-22'];
  const daily = ['2026-10-23'];
  // 10/20(화) 빠짐. 10/23은 일봉으로 있음. 10/26(월)·10/27(화)은 최근 이틀이라 보지 않음. 10/13 이전은 집계 시작 전
  assert.deepEqual(missingWeekdays(agg, daily, '2026-10-14', now), ['2026-10-20']);
  assert.deepEqual(missingWeekdays(agg, [], '2026-10-14', now), ['2026-10-20', '2026-10-23']);
  assert.deepEqual(missingWeekdays([], [], null, now), []); // 집계가 없으면 이음매 규칙이 맡음
});

test('같은 날짜가 두 번 오면 마지막 값을 쓰고, 날짜 순으로 정렬한다', () => {
  const rows = toDailyRows([bar('2026-10-21T00:00:00Z', 101), bar('2026-10-20T00:00:00Z', 100), bar('2026-10-21T05:00:00Z', 102)], Date.parse('2026-10-23T03:00:00Z'));
  assert.deepEqual(rows.map(row => row.close), [100, 102]);
});
