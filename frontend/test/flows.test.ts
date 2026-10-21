// 증시 자금 흐름 계산 테스트 (docs/Task_ORDER.md 11단계 A, D-46)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendFlowPoint, buildSankey, formatEok, toEok } from '../src/lib/flows.ts'

const point = (time: number, foreignNet = 0, institutionNet = 0, individualNet = 0) =>
  ({ time, foreignNet, institutionNet, individualNet, status: 'provisional' })

test('toEok · formatEok: 백만원을 억원으로 바꾸고 부호를 붙인다', () => {
  assert.equal(toEok(123_400), 1234)
  assert.equal(formatEok(123_400), '+1,234억')
  assert.equal(formatEok(-50_000), '-500억')
  assert.equal(formatEok(0), '0억')
})

test('appendFlowPoint: 새 시각은 뒤에 붙고, 같은 시각은 값만 바꾸고, 이른 시각은 버린다', () => {
  assert.deepEqual(appendFlowPoint([point(1)], point(2, 5)), [point(1), point(2, 5)])
  assert.deepEqual(appendFlowPoint([point(1), point(2, 5)], point(2, 7)), [point(1), point(2, 7)])
  const points = [point(1), point(3)]
  assert.equal(appendFlowPoint(points, point(2)), points)
})

test('buildSankey: 순매도 그룹 → 시장 → 순매수 그룹으로만 잇는다 (투자자끼리 직접 잇지 않음)', () => {
  const sankey = buildSankey({ foreignNet: 2000, institutionNet: 1000, individualNet: -3000 }, '코스피')
  assert.ok(sankey)
  if (!sankey) return
  assert.deepEqual(sankey.nodes.map(node => [node.name, node.side]), [
    ['개인', 'seller'], ['코스피', 'market'], ['외국인', 'buyer'], ['기관', 'buyer'],
  ])
  assert.deepEqual(sankey.links, [
    { source: 0, target: 1, value: 3000 },
    { source: 1, target: 2, value: 2000 },
    { source: 1, target: 3, value: 1000 },
  ])
  const marketIndex = sankey.nodes.findIndex(node => node.side === 'market')
  assert.ok(sankey.links.every(link => link.source === marketIndex || link.target === marketIndex))
})

test('buildSankey: 값이 모두 0이면 null', () => {
  assert.equal(buildSankey({ foreignNet: 0, institutionNet: 0, individualNet: 0 }, '코스피'), null)
})
