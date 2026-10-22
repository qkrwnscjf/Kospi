// 장단기 금리차 계산 테스트 (docs/Task_ORDER.md T-107)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spreadValue } from '../src/lib/spread.ts'

test('spreadValue: 10년물 − 13주, 전일 대비는 변화량의 차이(%p), 기준 시각은 더 오래된 쪽', () => {
  const value = spreadValue({ price: 4.215, changePrice: 0.03, timestamp: 2000 }, { price: 3.905, changePrice: -0.01, timestamp: 1000 })
  assert.deepEqual(value, { price: 0.31, changePrice: 0.04, timestamp: 1000 })
})

test('spreadValue: 금리 역전이면 음수', () => {
  assert.equal(spreadValue({ price: 3.9, timestamp: 1 }, { price: 4.1, timestamp: 1 }).price, -0.2)
})

test('spreadValue: 한쪽 변화량이 없으면 전일 대비를 계산하지 않는다 (0으로 채우지 않음)', () => {
  assert.equal(spreadValue({ price: 4, changePrice: 0.1, timestamp: 1 }, { price: 3, timestamp: 1 }).changePrice, undefined)
})
