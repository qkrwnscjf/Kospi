// 섹터 수익률 노드 계산 테스트 (docs/Task_ORDER.md D-66)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatReturn, rankSectors, returnDirection, returnIntensity, SECTOR_LABELS } from '../src/lib/sectors.ts'

const sector = (symbol: string, returnPct: number | null) => ({ symbol, returnPct, last: 1, dayChangeRate: 0, lastTime: 0, points: 20 })

test('rankSectors: 수익률 높은 순, 계산할 수 없는 섹터(null)는 맨 뒤', () => {
  const ranked = rankSectors([sector('A', -1), sector('B', null), sector('C', 3), sector('D', 0.5)])
  assert.deepEqual(ranked.map(item => item.symbol), ['C', 'D', 'A', 'B'])
})

test('returnDirection · formatReturn: 0.05% 미만은 보합, 없으면 —', () => {
  assert.equal(returnDirection(1.2), 'up')
  assert.equal(returnDirection(-0.3), 'down')
  assert.equal(returnDirection(0.01), 'flat')
  assert.equal(returnDirection(null), 'none')
  assert.equal(formatReturn(3.456), '+3.46%')
  assert.equal(formatReturn(-1), '-1.00%')
  assert.equal(formatReturn(null), '—')
})

test('returnIntensity: 최대 절댓값 대비 0.25 ~ 1', () => {
  assert.equal(returnIntensity(5, 10), 0.5)
  assert.equal(returnIntensity(-10, 10), 1)
  assert.equal(returnIntensity(0.1, 10), 0.25)
  assert.equal(returnIntensity(null, 10), 0.25)
})

test('섹터 이름표: 17종', () => {
  assert.equal(Object.keys(SECTOR_LABELS).length, 17)
})
