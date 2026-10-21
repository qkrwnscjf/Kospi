// 증시 자금 흐름 테스트 (docs/Task_ORDER.md 11단계 A)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLOW_ROOMS, parseInvestorFlow } from '../src/shared/flows.js';
import { isSubscribableSymbol } from '../src/shared/symbols.js';
import { firstRow, mapInvestorRow, FIELD_MAP } from '../src/infrastructure/flows/kis-investor-flows.js';

const VALID = {
  market: 'KOSPI', time: 1792000000000, foreignNet: 1200, institutionNet: -350, individualNet: -850, status: 'provisional', source: 'kis',
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

test('KIS 응답 매핑: 필드가 있으면 숫자 문자열을 숫자로 바꾼다', () => {
  const row = { [FIELD_MAP.foreignNet]: '1,200', [FIELD_MAP.institutionNet]: '-350', [FIELD_MAP.individualNet]: '-850' };
  assert.deepEqual(mapInvestorRow(row), { ok: true, values: { foreignNet: 1200, institutionNet: -350, individualNet: -850 } });
});

test('KIS 응답 매핑: 필드가 없거나 비어 있으면 0으로 채우지 않고 실패한다', () => {
  assert.deepEqual(mapInvestorRow(null), { ok: false, reason: 'no_output' });
  assert.deepEqual(mapInvestorRow({ [FIELD_MAP.foreignNet]: '' }), { ok: false, reason: 'field_foreign' });
  assert.deepEqual(mapInvestorRow({ [FIELD_MAP.foreignNet]: '1', [FIELD_MAP.institutionNet]: 'x' }), { ok: false, reason: 'field_institution' });
});

test('KIS 응답에서 첫 행을 꺼낸다 (배열 / 객체 / 없음)', () => {
  assert.deepEqual(firstRow({ output: [{ a: 1 }, { a: 2 }] }), { a: 1 });
  assert.deepEqual(firstRow({ output: { a: 3 } }), { a: 3 });
  assert.equal(firstRow({ output: [] }), null);
  assert.equal(firstRow({}), null);
});
