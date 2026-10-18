// Kafka 메시지 검증 테스트 (docs/Task_ORDER.md T-45, T-13, SEC-002)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTick } from '../src/shared/tick-validation.js';

const VALID = { symbol: 'KOSPI', category: 'domestic', price: 2650.12, changeRate: 0.45, changePrice: 11.8, timestamp: 1791961773000 };
const message = (value: unknown) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
const reasonOf = (value: unknown) => {
  const result = parseTick(message(value));
  return result.ok ? 'ok' : result.reason;
};

test('정상 tick은 통과한다', () => {
  const result = parseTick(message(VALID));
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.tick, VALID);
});

test('등락률 0은 정상값이다 (D-14)', () => {
  assert.equal(reasonOf({ ...VALID, changeRate: 0, changePrice: 0 }), 'ok');
});

test('빈 메시지, JSON이 아닌 메시지, 객체가 아닌 값은 거부한다', () => {
  assert.equal(parseTick(null).ok, false);
  assert.equal(parseTick(Buffer.alloc(0)).ok, false);
  assert.equal(reasonOf('not-json'), 'invalid_json');
  assert.equal(reasonOf([VALID]), 'not_object');
  assert.equal(reasonOf('null'), 'not_object');
});

test('허용되지 않는 심볼 형식은 거부한다', () => {
  for (const symbol of ['kospi', '', 'KOSPI;DROP', 'A'.repeat(21), 123]) {
    assert.equal(reasonOf({ ...VALID, symbol }), 'symbol', String(symbol));
  }
});

test('알 수 없는 카테고리는 거부한다', () => {
  assert.equal(reasonOf({ ...VALID, category: 'crypto' }), 'category');
});

test('가격이 0 이하이거나 숫자가 아니면 거부한다 (T-05)', () => {
  for (const price of [0, -1, '2650', null]) {
    assert.equal(reasonOf({ ...VALID, price }), 'price', String(price));
  }
});

test('시각과 등락률이 없으면 거부한다', () => {
  const { timestamp: _timestamp, ...withoutTimestamp } = VALID;
  const { changeRate: _changeRate, ...withoutChangeRate } = VALID;
  assert.equal(reasonOf(withoutTimestamp), 'timestamp');
  assert.equal(reasonOf(withoutChangeRate), 'change_rate');
});

test('선택 필드는 없어도 되지만, 있으면 유한한 숫자여야 한다', () => {
  const { changePrice: _changePrice, ...withoutChangePrice } = VALID;
  assert.equal(reasonOf(withoutChangePrice), 'ok');
  assert.equal(reasonOf({ ...VALID, volume: 'many' }), 'volume');
  assert.equal(reasonOf({ ...VALID, collectedAt: -1 }), 'collected_at');
  assert.equal(reasonOf({ ...VALID, producedAt: 0 }), 'produced_at');
});

test('장 상태는 정해진 값만 받는다 (T-56)', () => {
  const result = parseTick(message({ ...VALID, marketState: 'CLOSED' }));
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.tick.marketState, 'CLOSED');
  assert.equal(reasonOf({ ...VALID, marketState: 'HOLIDAY' }), 'market_state');
  assert.equal(reasonOf({ ...VALID, marketState: '<b>REGULAR</b>' }), 'market_state');
});

test('검증을 통과한 tick에는 알려진 필드만 남는다 (임의 필드가 브라우저까지 전달되지 않음)', () => {
  const result = parseTick(message({ ...VALID, injected: '<script>' }));
  assert.equal(result.ok, true);
  if (result.ok) assert.equal('injected' in result.tick, false);
});
