// 숫자 표시 테스트 (docs/Task_ORDER.md T-45, T-41)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatAxisNumber, formatNumber } from '../src/lib/format.ts'

test('formatNumber: 지표별 자릿수로 고정하고 천 단위 쉼표를 붙인다', () => {
  assert.equal(formatNumber(1392.5, 2), '1,392.50')
  assert.equal(formatNumber(4.2, 3), '4.200')
  assert.equal(formatNumber(4.51234, 4), '4.5123')
})

test('formatAxisNumber: 축 눈금은 끝자리 0을 생략한다', () => {
  assert.equal(formatAxisNumber(2650, 2), '2,650')
  assert.equal(formatAxisNumber(4.25, 3), '4.25')
})
