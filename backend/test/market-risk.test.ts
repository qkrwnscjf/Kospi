// 시장 연관성·리스크 테스트 (docs/Task_ORDER.md T-110)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  annualizedVolatility, beta, computeMarketRisk, correlation, isRiskRange, maxDrawdown, MIN_PAIRS,
  pairLagged, pairSameDay, toChanges, windowPoints, type Point,
} from '../src/shared/market-risk.js';

const DAY = 86_400_000;
const day = (n: number) => Date.UTC(2026, 9, 1) + n * DAY; // 2026-10-01 + n일 (UTC 0시, 집계 버킷과 같은 기준)
const series = (values: number[], start = 0): Point[] => values.map((value, index) => ({ time: day(start + index), value }));

test('windowPoints: 기간 안의 점만, 오늘(UTC) 버킷은 장중일 수 있어 뺀다', () => {
  const now = day(10) + 3 * 3600_000; // 10일째 03:00 UTC
  const points = windowPoints(series([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), 5, now);
  // 시작은 day(5) 03:00이라 day(6)부터, day(10)은 오늘이라 제외
  assert.deepEqual(points.map(point => point.value), [7, 8, 9, 10]);
});

test('toChanges: 수익률(%)과 변화량(%p)', () => {
  assert.deepEqual(toChanges(series([100, 110, 99]), 'return').map(point => Math.round(point.value * 100) / 100), [10, -10]);
  assert.deepEqual(toChanges(series([4.0, 4.25, 4.1]), 'change').map(point => Math.round(point.value * 100) / 100), [0.25, -0.15]);
});

test('correlation · beta: 완전 비례는 1, 반대는 −1, 베타는 기울기. 짝이 적으면 null', () => {
  const xs = Array.from({ length: MIN_PAIRS }, (_, index) => index - 4);
  const same = xs.map(x => [2 * x, x] as [number, number]);
  assert.equal(Math.round(correlation(same)! * 1000) / 1000, 1);
  assert.equal(Math.round(beta(same)! * 1000) / 1000, 2);
  const opposite = xs.map(x => [-x, x] as [number, number]);
  assert.equal(Math.round(correlation(opposite)! * 1000) / 1000, -1);
  assert.equal(correlation(same.slice(0, MIN_PAIRS - 1)), null);
  assert.equal(correlation(xs.map(() => [1, 1] as [number, number])), null); // 변화 없음
});

test('pairSameDay · pairLagged: 같은 날짜끼리, 그리고 코스피 날짜보다 이전의 가장 최근 상대 값', () => {
  const base = [{ time: day(2), value: 1 }, { time: day(3), value: 2 }, { time: day(6), value: 3 }];
  const other = [{ time: day(1), value: 10 }, { time: day(2), value: 20 }, { time: day(5), value: 50 }];
  assert.deepEqual(pairSameDay(base, other), [[1, 20]]);
  assert.deepEqual(pairLagged(base, other), [[1, 10], [2, 20], [3, 50]]);
});

test('annualizedVolatility · maxDrawdown', () => {
  const changes = series(Array.from({ length: MIN_PAIRS }, (_, index) => (index % 2 === 0 ? 1 : -1)));
  const daily = Math.sqrt(MIN_PAIRS / (MIN_PAIRS - 1)); // 표본 표준편차
  assert.equal(Math.round(annualizedVolatility(changes)! * 1000), Math.round(daily * Math.sqrt(252) * 1000));
  assert.equal(maxDrawdown(series([100, 120, 90, 110, 130])), -25);
  assert.equal(maxDrawdown(series([100])), null);
});

test('computeMarketRisk: 기간별 계산, 데이터가 없는 지표는 null로 둔다', () => {
  const now = day(40) + 3600_000;
  const kospi = series(Array.from({ length: 40 }, (_, index) => 100 + (index % 3) * 2 + index));
  const sp500 = series(Array.from({ length: 40 }, (_, index) => 200 + (index % 3) * 4 + index * 2));
  const risk = computeMarketRisk('1개월', { KOSPI: kospi, SP500: sp500 }, now);
  assert.equal(risk.base.symbol, 'KOSPI');
  assert.equal(risk.base.stats.points, 29); // day(11) ~ day(39)
  const sp = risk.targets.find(target => target.symbol === 'SP500')!;
  assert.ok(sp.sameDay.correlation !== null && sp.sameDay.correlation > 0.9);
  assert.equal(sp.sameDay.pairs, 28);
  const vix = risk.targets.find(target => target.symbol === 'VIX')!;
  assert.deepEqual([vix.stats.points, vix.sameDay.correlation, vix.stats.maxDrawdown], [0, null, null]);
  const rates = risk.targets.find(target => target.symbol === 'US10Y')!;
  assert.equal(rates.mode, 'change');
});

test('isRiskRange: 고정 목록만', () => {
  assert.equal(isRiskRange('3개월'), true);
  assert.equal(isRiskRange('1주'), false);
  assert.equal(isRiskRange('constructor'), false);
  assert.equal(isRiskRange(undefined), false);
});
