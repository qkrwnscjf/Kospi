// 시장 연관성·리스크 표시 테스트 (docs/Task_ORDER.md T-110)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { correlationBar, correlationStrength, formatSigned, toMarketRisk } from '../src/lib/risk.ts'

const stats = { points: 20, last: 1, lastTime: 1, periodChange: 1.5, volatility: 12, maxDrawdown: -3 }
const pair = { correlation: 0.5, beta: 0.8, pairs: 19 }

test('correlationStrength: 절댓값 기준 세기와 방향', () => {
  assert.equal(correlationStrength(0.82), '강함 · 같은 방향')
  assert.equal(correlationStrength(-0.45), '보통 · 반대 방향')
  assert.equal(correlationStrength(0.1), '거의 없음')
  assert.equal(correlationStrength(null), '계산 불가')
})

test('correlationBar: 가운데 기준으로 양수는 오른쪽, 음수는 왼쪽', () => {
  assert.deepEqual(correlationBar(0.5), { left: 50, width: 25 })
  assert.deepEqual(correlationBar(-1), { left: 0, width: 50 })
  assert.deepEqual(correlationBar(null), { left: 50, width: 0 })
})

test('formatSigned: 부호와 자릿수, 값이 없으면 —', () => {
  assert.equal(formatSigned(1.234, 2, '%'), '+1.23%')
  assert.equal(formatSigned(-0.5, 1), '-0.5')
  assert.equal(formatSigned(null), '—')
})

test('toMarketRisk: 형식이 맞는 지표만 남긴다', () => {
  const ok = { symbol: 'SP500', mode: 'return', stats, sameDay: pair, lagged: pair }
  const parsed = toMarketRisk({ range: '1개월', base: { symbol: 'KOSPI', stats }, targets: [ok, { ...ok, mode: 'x' }, { ...ok, sameDay: { correlation: 'a' } }] })
  assert.equal(parsed?.targets.length, 1)
  assert.equal(toMarketRisk({ range: '1개월', base: {}, targets: [] }), null)
  assert.equal(toMarketRisk(null), null)
})
