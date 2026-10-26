// 15단계 분석 카테고리 표시 테스트 (docs/Task_ORDER.md T-111 ~ T-113)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { monthGrid, shiftMonth, toCalendarDays, toCalendarItems } from '../src/lib/calendar.ts'
import { formatWonShort, toRankingItems } from '../src/lib/rankings.ts'
import { formatAge, formatBytes, jobState, toPipelineStatus } from '../src/lib/pipeline.ts'

test('monthGrid: 월요일 시작, 그 달이 아닌 칸은 null, 7칸씩', () => {
  const weeks = monthGrid('2026-10') // 2026-10-01은 목요일
  assert.deepEqual(weeks[0], [null, null, null, '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'])
  assert.ok(weeks.every(week => week.length === 7))
  assert.equal(weeks.flat().filter(Boolean).length, 31)
})

test('shiftMonth: 해를 넘긴다', () => {
  assert.equal(shiftMonth('2026-01', -1), '2025-12')
  assert.equal(shiftMonth('2026-12', 1), '2027-01')
})

test('toCalendarDays · toCalendarItems: 형식이 맞는 것만', () => {
  const days = toCalendarDays([{ date: '2026-10-23', earnings: 2, dividend: 1, report: 0, highlights: [{ corpName: 'A', type: 'earnings' }, { corpName: 'B', type: 'x' }] }, { date: 'bad' }])
  assert.equal(days.length, 1)
  assert.equal(days[0]?.highlights.length, 1)
  assert.equal(toCalendarItems([{ rceptNo: '1', corpName: 'A', reportName: 'R', type: 'dividend' }, { rceptNo: 2 }]).length, 1)
})

test('rankings: 형식 검사, 금액 표시', () => {
  const ok = { rank: 1, code: '005930', name: '삼성전자', close: 1, changeRate: 1, tradingValue: null, marketCap: 2 }
  assert.equal(toRankingItems([ok, { ...ok, code: '<x>' }]).length, 1)
  assert.equal(formatWonShort(4.25e14), '425조')
  assert.equal(formatWonShort(8.5e11), '8,500억')
  assert.equal(formatWonShort(null), '—')
})

test('toPipelineStatus: 필요한 필드만 꺼내고, 형식이 다르면 null', () => {
  const status = toPipelineStatus({
    prometheus: 'ok', services: [{ job: 'worker', up: true }, { job: 1 }],
    kafka: { gatewayConnected: true, consumerLag: [{ group: 'db-sink', lag: 0 }], dlq: [] },
    collectors: { yahoo15m: { success: 180, error: 'x' } }, db: { jobs: [{ job: 'retention:market_ticks', failures: 0, delayRatio: 0.5 }] },
  })
  assert.equal(status?.services.length, 1)
  assert.deepEqual(status?.yahoo15m, { success: 180 })
  assert.equal(status?.dbJobs[0]?.delayRatio, 0.5)
  assert.equal(status?.dartLastSuccessAge, null)
  assert.equal(toPipelineStatus({ prometheus: 'maybe' }), null)
})

test('pipeline: 경과 시간·용량 표시, DB 작업 상태', () => {
  assert.equal(formatAge(30), '방금')
  assert.equal(formatAge(600), '10분')
  assert.equal(formatAge(5400), '1.5시간')
  assert.equal(formatAge(3 * 86_400), '3.0일')
  assert.equal(formatBytes(28.1 * 1024 ** 2), '28.1MB')
  assert.equal(jobState(0, 1), 'ok')
  assert.equal(jobState(1, 1), 'failed_before')
  assert.equal(jobState(0, 3.5), 'stalled')
})
