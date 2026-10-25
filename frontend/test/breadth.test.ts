// 시장 폭·거래대금 표시 테스트 (docs/Task_ORDER.md T-106)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { breadthShares, formatTradingValue, netAdvancers } from '../src/lib/breadth.ts'

const point = { time: 1, advancers: 600, decliners: 300, unchanged: 100, stocks: 1000, tradingValue: 12_345_000_000_000 }

test('formatTradingValue: 1조 이상은 조원, 그 아래는 억원, 잘못된 값은 —', () => {
  assert.equal(formatTradingValue(12_345_000_000_000), '12.3조원')
  assert.equal(formatTradingValue(850_000_000_000), '8,500억원')
  assert.equal(formatTradingValue(Number.NaN), '—')
})

test('netAdvancers · breadthShares: 상승 − 하락, 비율 합 100', () => {
  assert.equal(netAdvancers(point), 300)
  assert.deepEqual(breadthShares(point), { up: 60, flat: 10, down: 30 })
  assert.deepEqual(breadthShares({ ...point, stocks: 0 }), { up: 0, flat: 0, down: 0 })
})
