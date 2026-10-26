import { useEffect, useState } from 'react'
import { toCalendarDays, toCalendarItems, type CalendarDay, type CalendarItem } from '@/lib/calendar'
import { toRankingItems, type RankingItem } from '@/lib/rankings'
import { toPipelineStatus } from '@/lib/pipeline'
import type { ChartStatus } from '@/hooks/useMarketData'

// 15단계 분석 카테고리 데이터 (docs/Task_ORDER.md T-111 ~ T-113)
// - 실적·배당 캘린더: `/api/v1/disclosures/calendar?month=` · `?date=`
// - 종목 순위: `/api/v1/market/rankings?market=&type=&date=`
// - 파이프라인 상태: `/api/v1/system/pipeline` (설정 창이 열려 있을 때만 30초마다)

const HISTORY_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1/market/history'
const API_BASE = HISTORY_URL.replace(/\/market\/history$/, '')

// 공통: url이 바뀌면 다시 받고, 이전 요청의 결과는 버린다. url이 null이면 받지 않는다
function useApi<T>(url: string | null, parse: (body: unknown) => T | null, refreshMs = 0) {
  const [data, setData] = useState<T | null>(null)
  const [status, setStatus] = useState<ChartStatus>('loading')

  useEffect(() => {
    if (url === null) return
    let cancelled = false
    const load = () =>
      fetch(url)
        .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
        .then(body => {
          if (cancelled) return
          const parsed = parse(body)
          setData(parsed)
          setStatus(parsed === null ? 'error' : 'loaded')
        })
        .catch(err => {
          if (cancelled) return
          console.error('Failed to fetch', err)
          setStatus('error')
        })
    setStatus('loading')
    void load()
    const timer = refreshMs > 0 ? setInterval(() => void load(), refreshMs) : undefined
    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
    // parse는 모듈 수준 함수만 넘긴다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, refreshMs])

  return { data, status }
}

const asObject = (body: unknown) => (body && typeof body === 'object' ? (body as Record<string, unknown>) : null)
const coverageOf = (value: unknown) => {
  const record = asObject(value)
  return record && typeof record.since === 'string' && typeof record.until === 'string' ? { since: record.since, until: record.until } : null
}

export interface CalendarMonth { month: string; days: CalendarDay[]; coverage: { since: string; until: string } | null }
const parseMonth = (body: unknown): CalendarMonth | null => {
  const record = asObject(body)
  return record && typeof record.month === 'string' ? { month: record.month, days: toCalendarDays(record.days), coverage: coverageOf(record.coverage) } : null
}
export const useDisclosureCalendar = (month: string) =>
  useApi(`${API_BASE}/disclosures/calendar?month=${encodeURIComponent(month)}`, parseMonth)

export interface CalendarDayList { date: string; items: CalendarItem[]; limit: number }
const parseDay = (body: unknown): CalendarDayList | null => {
  const record = asObject(body)
  return record && typeof record.date === 'string'
    ? { date: record.date, items: toCalendarItems(record.items), limit: typeof record.limit === 'number' ? record.limit : 0 }
    : null
}
export const useCalendarDay = (date: string | null) =>
  useApi(date === null ? null : `${API_BASE}/disclosures/calendar?date=${encodeURIComponent(date)}`, parseDay)

export interface Rankings { date: string | null; items: RankingItem[]; coverage: Record<string, { since: string; until: string } | null> }
const parseRankings = (body: unknown): Rankings | null => {
  const record = asObject(body)
  if (!record) return null
  const coverage = asObject(record.coverage) ?? {}
  return {
    date: typeof record.date === 'string' ? record.date : null,
    items: toRankingItems(record.items),
    coverage: Object.fromEntries(Object.entries(coverage).map(([market, value]) => [market, coverageOf(value)])),
  }
}
export const useRankings = (market: string, type: string, date: string | null) =>
  useApi(`${API_BASE}/market/rankings?market=${encodeURIComponent(market)}&type=${encodeURIComponent(type)}${date ? `&date=${encodeURIComponent(date)}` : ''}`, parseRankings)

// 파이프라인 상태: 형식 검사(toPipelineStatus)를 거친 값만 쓴다
export const usePipelineStatus = (enabled: boolean) =>
  useApi(enabled ? `${API_BASE}/system/pipeline` : null, toPipelineStatus, 30_000)
