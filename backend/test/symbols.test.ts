// 심볼 허용 목록 테스트 (docs/Task_ORDER.md T-45, SEC-005)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAVER_KEYS, YAHOO_KEYS, isSubscribableSymbol, isYahooSymbolKey } from '../src/shared/symbols.js';
import { parseTick } from '../src/shared/tick-validation.js';

test('알려진 16개 심볼만 구독할 수 있다', () => {
  for (const symbol of [...YAHOO_KEYS, ...NAVER_KEYS]) {
    assert.equal(isSubscribableSymbol(symbol), true, symbol);
  }
  assert.equal(YAHOO_KEYS.length + NAVER_KEYS.length, 16);
});

test('목록에 없는 값, 문자열이 아닌 값, 객체 속성 이름은 거부한다', () => {
  for (const value of ['kospi', '', 'BTC', '__proto__', 'constructor', 'toString', 123, null, undefined, ['KOSPI'], { symbol: 'KOSPI' }]) {
    assert.equal(isSubscribableSymbol(value), false, String(value));
  }
  assert.equal(isYahooSymbolKey('constructor'), false);
  assert.equal(isYahooSymbolKey('VKOSPI'), false);
});

test('Yahoo와 Naver 심볼 이름이 겹치지 않는다', () => {
  const yahoo = new Set<string>(YAHOO_KEYS);
  assert.deepEqual(NAVER_KEYS.filter(key => yahoo.has(key)), []);
});

test('구독 가능한 심볼은 모두 Kafka 메시지 검증의 심볼 형식을 통과한다', () => {
  for (const symbol of [...YAHOO_KEYS, ...NAVER_KEYS]) {
    const tick = { symbol, category: 'domestic', price: 1, changeRate: 0, timestamp: 1 };
    assert.equal(parseTick(Buffer.from(JSON.stringify(tick))).ok, true, symbol);
  }
});
