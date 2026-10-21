// KRX 일별 지수(T-67)와 DART 공시(12단계) 테스트
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KRX_DAILY_KEYS, isKrxDailySymbol, symbolForIndexName } from '../src/shared/krx-indices.js';
import { NAVER_KEYS, isSubscribableSymbol } from '../src/shared/symbols.js';
import { closeTimestamp, combineCoverage, mapIndexRows, missingDates, parseKrxNumber, seoulWeekdays, FIELDS } from '../src/infrastructure/krx/krx-index-daily.js';
import { backfillRanges } from '../src/infrastructure/disclosures/dart-disclosures.js';
import { DISCLOSURE_ROOM, parseDisclosure } from '../src/shared/disclosures.js';
import { classifyReport, mapListItem, parseAmount, sumAmountFields } from '../src/infrastructure/disclosures/dart-disclosures.js';
import { DartApiError, DartClient } from '../src/infrastructure/disclosures/dart-client.js';
import { KrxApiError, KrxClient } from '../src/infrastructure/krx/krx-client.js';

test('KRX 일별 지수 심볼은 기존 Naver 6종 심볼과 같다 (화면·구독 허용 목록 그대로 사용)', () => {
  assert.deepEqual([...KRX_DAILY_KEYS].sort(), [...NAVER_KEYS].sort());
  assert.equal(isKrxDailySymbol('KOSPI'), false);
});

test('KRX 지수 이름은 공백·대소문자를 무시하고 엔드포인트별로 찾는다', () => {
  assert.equal(symbolForIndexName('krx', 'KRX 반도체'), 'KRX_SEMI');
  assert.equal(symbolForIndexName('krx', 'krx반도체'), 'KRX_SEMI');
  assert.equal(symbolForIndexName('drvprod', '코스피 200 변동성지수'), 'VKOSPI');
  assert.equal(symbolForIndexName('krx', '코스피 200 변동성지수'), undefined);
  assert.equal(symbolForIndexName('krx', 'KRX 300'), undefined);
});

test('KRX 숫자: 쉼표 제거, 빈 값·"-"는 0이 아니라 null', () => {
  assert.equal(parseKrxNumber('1,234.56'), 1234.56);
  assert.equal(parseKrxNumber('-1.20'), -1.2);
  assert.equal(parseKrxNumber('-'), null);
  assert.equal(parseKrxNumber(''), null);
  assert.equal(parseKrxNumber('abc'), null);
});

test('KRX 응답 행 → tick: 대상만 남기고, 종가가 없으면 버린다. 기준 시각은 15:30 KST', () => {
  const rows = [
    { [FIELDS.name]: 'KRX 반도체', [FIELDS.close]: '4,321.10', [FIELDS.change]: '12.30', [FIELDS.changeRate]: '0.29' },
    { [FIELDS.name]: 'KRX 은행', [FIELDS.close]: '-', [FIELDS.change]: '-', [FIELDS.changeRate]: '-' },
    { [FIELDS.name]: 'KRX 300', [FIELDS.close]: '1,500.00', [FIELDS.change]: '1', [FIELDS.changeRate]: '0.1' },
  ];
  const { ticks, invalid } = mapIndexRows('krx', '20261019', rows);
  assert.equal(ticks.length, 1);
  assert.deepEqual(ticks[0], { symbol: 'KRX_SEMI', category: 'sector', price: 4321.1, changeRate: 0.29, changePrice: 12.3, timestamp: closeTimestamp('20261019') });
  assert.deepEqual(invalid, ['KRX_BANK']);
  assert.equal(new Date(closeTimestamp('20261019')).toISOString(), '2026-10-19T06:30:00.000Z');
});

test('KRX 전일 대비: 실제 필드(CMPPREVDD_IDX)가 없으면 예전 이름(CMPPREV_IDX)을 쓴다', () => {
  const rows = [{ [FIELDS.name]: 'KRX 자동차', [FIELDS.close]: '2,000.00', CMPPREV_IDX: '-5.5', [FIELDS.changeRate]: '-0.27' }];
  assert.equal(mapIndexRows('krx', '20261019', rows).ticks[0]?.changePrice, -5.5);
});

test('서울 기준 평일 목록: 주말을 빼고 오래된 날부터', () => {
  // 2026-10-19(월) 12:00 KST
  const dates = seoulWeekdays(Date.UTC(2026, 9, 19, 3, 0), 7);
  assert.deepEqual(dates, ['20261012', '20261013', '20261014', '20261015', '20261016', '20261019']);
});

// SEC-014: 재시작 때 빠진 기간만 채우기
test('KRX 빠진 날짜: 저장 범위 이후만 받고, 목표 시작일 근처의 빈 날은 다시 받지 않는다', () => {
  const target = ['20251015', '20251016', '20251017', '20261009', '20261012', '20261013'];
  assert.deepEqual(missingDates(target, null), target);
  // 저장: 2025-10-20 ~ 2026-10-09 (목표 시작일 + 10일 안에서 시작) → 이후 날짜만
  assert.deepEqual(missingDates(target, { earliest: '20251020', latest: '20261009' }), ['20261012', '20261013']);
  // 저장이 한참 늦게 시작 → 앞쪽도 받음
  assert.deepEqual(missingDates(target, { earliest: '20261009', latest: '20261013' }), ['20251015', '20251016', '20251017']);
  assert.deepEqual(missingDates(target, { earliest: '20251015', latest: '20261013' }), []);
});

test('여러 심볼의 저장 범위는 모두에게 있는 범위로 합치고, 하나라도 비면 전부 받는다', () => {
  assert.deepEqual(combineCoverage([{ earliest: '20251020', latest: '20261020' }, { earliest: '20251022', latest: '20261017' }]),
    { earliest: '20251022', latest: '20261017' });
  assert.equal(combineCoverage([{ earliest: '20251020', latest: '20261020' }, null]), null);
  assert.equal(combineCoverage([]), null);
});

test('DART 과거 채우기 범위: 앞쪽 빈 기간과 마지막 저장일 하루 전 ~ 오늘만, 저장된 것이 없으면 전체', () => {
  assert.deepEqual(backfillRanges('20251021', '20261021', null), [['20251021', '20261021']]);
  // 90일만 저장된 상태에서 1년으로 늘림 → 앞쪽 빈 기간 + 뒤쪽
  assert.deepEqual(backfillRanges('20251021', '20261021', { earliest: '20260723', latest: '20261021' }),
    [['20251021', '20260722'], ['20261020', '20261021']]);
  // 앞쪽이 이미 채워져 있으면(허용 오차 3일 안) 뒤쪽만
  assert.deepEqual(backfillRanges('20251021', '20261021', { earliest: '20251023', latest: '20261020' }), [['20261019', '20261021']]);
  assert.deepEqual(backfillRanges('20260722', '20261021', { earliest: '20260722', latest: '20260722' }), [['20260722', '20261021']]);
});

test('공시 제목 분류: 희석·주주환원·처분·정정·종속회사', () => {
  assert.deepEqual(classifyReport('주요사항보고서(유상증자결정)'), { group: 'dilution', kind: 'rights_offering', isCorrection: false });
  assert.deepEqual(classifyReport('[기재정정]주요사항보고서(전환사채권발행결정)'), { group: 'dilution', kind: 'cb', isCorrection: true });
  assert.equal(classifyReport('주요사항보고서(자기주식취득결정)').kind, 'buyback');
  assert.equal(classifyReport('주요사항보고서(자기주식취득신탁계약체결결정)').kind, 'buyback_trust');
  assert.equal(classifyReport('주요사항보고서(자기주식취득신탁계약해지결정)').group, 'other');
  assert.equal(classifyReport('주식소각결정').group, 'shareholder_return');
  assert.equal(classifyReport('주요사항보고서(자기주식처분결정)').group, 'treasury_disposal');
  assert.equal(classifyReport('주요사항보고서(무상증자결정)').kind, 'bonus_issue');
  assert.equal(classifyReport('주요사항보고서(유무상증자결정)').group, 'dilution');
  assert.equal(classifyReport('유상증자결정(종속회사의주요경영사항)').group, 'other');
  assert.equal(classifyReport('유상증자결정(자회사의 주요경영사항)').group, 'other');
  assert.equal(classifyReport('연결재무제표기준영업(잠정)실적(공정공시)').group, 'earnings');
  assert.equal(classifyReport('임원ㆍ주요주주특정증권등소유상황보고서').group, 'ownership');
});

const LIST_ITEM = {
  corp_code: '00126380', corp_name: '테스트전자', stock_code: '005930', corp_cls: 'Y',
  report_nm: '주요사항보고서(자기주식취득결정)', rcept_no: '20261019000123', flr_nm: '홍길동', rcept_dt: '20261019', rm: '유',
};

test('공시 목록 항목: 제출인 이름(flr_nm)은 읽지 않고, 유가증권이 아니거나 형식이 틀리면 버린다', () => {
  const mapped = mapListItem(LIST_ITEM);
  assert.ok(mapped);
  assert.equal(JSON.stringify(mapped).includes('홍길동'), false);
  assert.equal(mapped?.rceptDate, '2026-10-19');
  assert.equal(mapped?.group, 'shareholder_return');
  assert.equal(mapListItem({ ...LIST_ITEM, corp_cls: 'K' }), null);
  assert.equal(mapListItem({ ...LIST_ITEM, rcept_no: '2026' }), null);
  assert.equal(mapListItem({ ...LIST_ITEM, stock_code: '' }), null);
});

test('금액: 비어 있으면 0이 아니라 null, 여러 필드는 합계', () => {
  assert.equal(parseAmount('1,000,000'), 1_000_000);
  assert.equal(parseAmount('-'), null);
  assert.equal(parseAmount('-5'), null);
  assert.equal(sumAmountFields({ a: '100', b: '-' }, ['a', 'b']), 100);
  assert.equal(sumAmountFields({ a: '-', b: '' }, ['a', 'b']), null);
});

const DISCLOSURE = {
  rceptNo: '20261019000123', rceptDate: '2026-10-19', corpCode: '00126380', stockCode: '005930', corpName: '테스트전자',
  reportName: '주요사항보고서(자기주식취득결정)', group: 'shareholder_return', kind: 'buyback', isCorrection: false,
  amount: 100_000_000_000, market: 'KOSPI', live: true,
};
const reasonOf = (value: unknown) => {
  const result = parseDisclosure(Buffer.from(JSON.stringify(value)));
  return result.ok ? 'ok' : result.reason;
};

test('공시 메시지 검증: 정상·금액 없음(null)은 통과, 형식이 틀리면 거부, 알려진 필드만 남김', () => {
  assert.equal(reasonOf(DISCLOSURE), 'ok');
  assert.equal(reasonOf({ ...DISCLOSURE, amount: null }), 'ok');
  assert.equal(reasonOf({ ...DISCLOSURE, amount: -1 }), 'amount');
  assert.equal(reasonOf({ ...DISCLOSURE, rceptNo: '../etc' }), 'rcept_no');
  assert.equal(reasonOf({ ...DISCLOSURE, group: 'guess' }), 'group');
  assert.equal(reasonOf({ ...DISCLOSURE, corpName: 'a\u0000b' }), 'corp_name');
  const result = parseDisclosure(Buffer.from(JSON.stringify({ ...DISCLOSURE, filer: '홍길동' })));
  assert.equal(result.ok && 'filer' in result.disclosure, false);
});

test('공시 방은 구독 허용 목록에 있다', () => {
  assert.equal(isSubscribableSymbol(DISCLOSURE_ROOM), true);
  assert.equal(isSubscribableSymbol('disclosures:KOSDAQ'), false);
});

// 보안: 요청 값 검증과 오류 메시지에 키가 들어가지 않는지 (네트워크 호출 없이 확인)
const FAKE_KEY = 'testkey0123456789abcdef0123456789abcdef';

test('DART 클라이언트: 주소·요청 값이 형식에 맞지 않으면 호출하지 않고, 오류에 키가 없다', async () => {
  const client = new DartClient({ apiKey: FAKE_KEY });
  for (const [endpoint, params] of [
    ['../list.json', {}],
    ['list.json?x=1', {}],
    ['list.json', { bgn_de: '2026-10-19' }],
    ['list.json', { 'crtfc_key&x': '1' }],
    ['list.json', { crtfc_key: 'otherkey' }],
  ] as const) {
    await assert.rejects(client.get(endpoint, params as Record<string, string>), (error: unknown) => {
      assert.ok(error instanceof DartApiError);
      assert.equal(error.message, 'invalid_request');
      assert.equal(JSON.stringify({ message: error.message, ...error }).includes(FAKE_KEY), false);
      return true;
    });
  }
});

test('KRX 클라이언트: 경로·날짜가 형식에 맞지 않으면 호출하지 않는다', async () => {
  const client = new KrxClient({ apiKey: FAKE_KEY });
  await assert.rejects(client.get('https://example.com/x', '20261019'), (error: unknown) => error instanceof KrxApiError && error.message === 'invalid_request');
  await assert.rejects(client.get('/idx/krx_dd_trd', '2026-10-19'), (error: unknown) => error instanceof KrxApiError && error.message === 'invalid_request');
});
