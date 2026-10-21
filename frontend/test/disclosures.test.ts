// 공시 표시 계산 테스트 (docs/Task_ORDER.md 12단계 T-78)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dartViewerUrl, formatKrw, groupLabel, mergeDisclosures, seoulToday } from '../src/lib/disclosures.ts'

const item = (rceptNo: string, corpName = 'A') => ({
  rceptNo, rceptDate: '2026-10-19', stockCode: '005930', corpName, reportName: 'r', group: 'other', kind: 'other', isCorrection: false, amount: null,
})

test('formatKrw: 억원·조원, 금액이 없으면 0이 아니라 "금액 없음"', () => {
  assert.equal(formatKrw(null), '금액 없음')
  assert.equal(formatKrw(150_000_000_000), '1,500억원')
  assert.equal(formatKrw(2_500_000_000_000), '2.5조원')
  assert.equal(formatKrw(0), '0원')
})

test('mergeDisclosures: 접수번호로 중복 제거, 최신순, 개수 상한', () => {
  const merged = mergeDisclosures([item('20261019000001'), item('20261019000002')], [item('20261019000003'), item('20261019000001', 'B')], 2)
  assert.deepEqual(merged.map(entry => entry.rceptNo), ['20261019000003', '20261019000002'])
  const replaced = mergeDisclosures([item('20261019000001')], [item('20261019000001', 'B')])
  assert.equal(replaced.length, 1)
  assert.equal(replaced[0]?.corpName, 'B')
})

test('dartViewerUrl: 숫자 14자리 접수번호만 주소로 만든다', () => {
  assert.equal(dartViewerUrl('20261019000001'), 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20261019000001')
  assert.equal(dartViewerUrl('javascript:alert(1)'), null)
  assert.equal(dartViewerUrl('2026101900000&x=1'), null)
})

test('groupLabel · seoulToday', () => {
  assert.equal(groupLabel('dilution'), '희석')
  assert.equal(groupLabel('unknown'), '기타')
  assert.equal(seoulToday(Date.UTC(2026, 9, 19, 16, 0)), '2026-10-20') // 01:00 KST
})
