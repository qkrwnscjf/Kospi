// 증시 자금 흐름 메시지 검증 테스트 (docs/Task_ORDER.md 11단계 B′)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLOW_ROOMS, parseInvestorFlow } from '../src/shared/flows.js';
import { isSubscribableSymbol } from '../src/shared/symbols.js';

const VALID = {
  market: 'KOSPI', time: 1792000000000, foreignNet: 1200, institutionNet: -350, individualNet: -850, status: 'final', source: 'krx',
};
const message = (value: unknown) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
const reasonOf = (value: unknown) => {
  const result = parseInvestorFlow(message(value));
  return result.ok ? 'ok' : result.reason;
};

test('정상 자금 흐름은 통과하고, 순매도(음수)와 0은 정상값이다', () => {
  assert.equal(reasonOf(VALID), 'ok');
  assert.equal(reasonOf({ ...VALID, foreignNet: 0 }), 'ok');
});

test('알 수 없는 시장·상태·출처와 숫자가 아닌 값은 거부한다', () => {
  assert.equal(reasonOf({ ...VALID, market: 'NASDAQ' }), 'market');
  assert.equal(reasonOf({ ...VALID, status: 'guess' }), 'status');
  assert.equal(reasonOf({ ...VALID, source: 'naver' }), 'source');
  assert.equal(reasonOf({ ...VALID, foreignNet: '1200' }), 'foreign_net');
  assert.equal(reasonOf({ ...VALID, time: 0 }), 'time');
  assert.equal(reasonOf('not-json'), 'invalid_json');
});

test('검증을 통과한 흐름에는 알려진 필드만 남는다', () => {
  const result = parseInvestorFlow(message({ ...VALID, injected: '<script>' }));
  assert.equal(result.ok, true);
  if (result.ok) assert.equal('injected' in result.flow, false);
});

test('자금 흐름 방은 구독 허용 목록에 있고, 다른 접두어는 거부된다', () => {
  for (const room of FLOW_ROOMS) assert.equal(isSubscribableSymbol(room), true, room);
  assert.equal(isSubscribableSymbol('flows:NASDAQ'), false);
  assert.equal(isSubscribableSymbol('flows:'), false);
});
