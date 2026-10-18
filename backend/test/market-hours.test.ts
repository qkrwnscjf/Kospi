// 장 시간 판단 테스트 (docs/Task_ORDER.md T-45, T-07, D-16)
// frontend/test/marketHours.test.ts에 같은 사례가 있다. 두 파일의 규칙이 어긋나면 한쪽이 실패한다 (D-36).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MARKETS, YAHOO_MARKET, decideMarketStatus, type MarketId } from '../src/infrastructure/ingestion/market-hours.js';
import { YAHOO_KEYS } from '../src/shared/symbols.js';

const isOpen = (market: MarketId, iso: string) => {
  const found = MARKETS.find(item => item.id === market);
  assert.ok(found, market);
  return found.isOpen(new Date(iso));
};

// [시장, UTC 시각, 기대값, 설명]. 2026-10-16은 금요일, 미국은 서머타임(EDT, UTC-4) 기간이다.
const CASES: [MarketId, string, boolean, string][] = [
  ['krx', '2026-10-16T01:00:00Z', true, '금 10:00 KST'],
  ['krx', '2026-10-15T23:59:00Z', false, '금 08:59 KST (개장 전)'],
  ['krx', '2026-10-16T06:29:00Z', true, '금 15:29 KST'],
  ['krx', '2026-10-16T06:30:00Z', false, '금 15:30 KST (마감)'],
  ['krx', '2026-10-17T01:00:00Z', false, '토 10:00 KST'],
  ['us_equity', '2026-10-16T13:30:00Z', true, '금 09:30 EDT (개장)'],
  ['us_equity', '2026-10-16T13:29:00Z', false, '금 09:29 EDT'],
  ['us_equity', '2026-10-16T20:00:00Z', false, '금 16:00 EDT (마감)'],
  ['us_equity', '2026-12-15T14:30:00Z', true, '화 09:30 EST (서머타임 끝난 뒤)'],
  ['us_equity', '2026-12-15T14:29:00Z', false, '화 09:29 EST'],
  ['global_24h', '2026-10-14T16:00:00Z', true, '수 12:00 EDT'],
  ['global_24h', '2026-10-16T20:59:00Z', true, '금 16:59 EDT'],
  ['global_24h', '2026-10-16T21:00:00Z', false, '금 17:00 EDT (주간 마감)'],
  ['global_24h', '2026-10-17T16:00:00Z', false, '토 12:00 EDT'],
  ['global_24h', '2026-10-18T21:59:00Z', false, '일 17:59 EDT'],
  ['global_24h', '2026-10-18T22:00:00Z', true, '일 18:00 EDT (주간 개장)'],
];

for (const [market, iso, expected, label] of CASES) {
  test(`${market}: ${label} → ${expected ? '열림' : '닫힘'}`, () => {
    assert.equal(isOpen(market, iso), expected);
  });
}

// 공휴일 반영 (T-56, D-40): 시간표와 소스 장 상태를 합친 판단
test('decideMarketStatus: 장 시간 밖이면 소스와 상관없이 closed', () => {
  assert.equal(decideMarketStatus(false, ['REGULAR']), 'closed');
  assert.equal(decideMarketStatus(false, []), 'closed');
});

test('decideMarketStatus: 장 시간 + 소스 REGULAR(하나라도) → open', () => {
  assert.equal(decideMarketStatus(true, ['REGULAR', 'REGULAR']), 'open');
  assert.equal(decideMarketStatus(true, ['CLOSED', 'REGULAR']), 'open');
});

test('decideMarketStatus: 장 시간 + 소스 장 상태를 모르면 이전처럼 open (시간표로 대체)', () => {
  assert.equal(decideMarketStatus(true, []), 'open');
  assert.equal(decideMarketStatus(true, [undefined, undefined]), 'open');
});

test('decideMarketStatus: 장 시간인데 소스가 모두 닫혀 있으면 holiday (공휴일)', () => {
  assert.equal(decideMarketStatus(true, ['CLOSED', 'CLOSED']), 'holiday');
  assert.equal(decideMarketStatus(true, ['CLOSED', undefined]), 'holiday');
  assert.equal(decideMarketStatus(true, ['PRE', 'POST']), 'holiday');
});

test('모든 Yahoo 지표에 시장이 지정되어 있다', () => {
  for (const key of YAHOO_KEYS) {
    assert.ok(YAHOO_MARKET[key], key);
  }
});
