import { useEffect, useState } from 'react'
import { subscribeDisclosures } from '@/lib/marketSocket'
import { mergeDisclosures, type DisclosureItem } from '@/lib/disclosures'
import type { ChartStatus } from '@/hooks/useMarketData'

// 공시·자본 이벤트 데이터 (docs/Task_ORDER.md 12단계 T-78)
// - 최근 공시: REST `/api/v1/disclosures/recent` + 공유 소켓의 새 공시(방 `disclosures:KOSPI`)
// - 자본 이벤트: REST `/api/v1/disclosures/capital-events`

const HISTORY_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1/market/history'
const DISCLOSURES_URL = HISTORY_URL.replace(/market\/history$/, 'disclosures')

export interface DisclosureScope {
  scope: 'kospi100' | 'kospi_all'
  scopeAsOf: string | null
}

export function useRecentDisclosures(group: string) {
  const [items, setItems] = useState<DisclosureItem[]>([])
  const [status, setStatus] = useState<ChartStatus>('loading')
  const [scope, setScope] = useState<DisclosureScope | null>(null)

  useEffect(() => {
    let cancelled = false
    setItems([])
    setStatus('loading')

    fetch(`${DISCLOSURES_URL}/recent?group=${encodeURIComponent(group)}`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(body => {
        if (cancelled) return
        const data: DisclosureItem[] = Array.isArray(body?.data) ? body.data : []
        setItems(previous => mergeDisclosures(data, previous))
        setScope({ scope: body?.scope === 'kospi100' ? 'kospi100' : 'kospi_all', scopeAsOf: typeof body?.scopeAsOf === 'string' ? body.scopeAsOf : null })
        setStatus('loaded')
      })
      .catch(err => {
        if (cancelled) return
        console.error('Failed to fetch disclosures', err)
        setStatus('error')
      })

    // 새 공시는 고른 분류에 맞는 것만 목록 위에 붙인다
    const unsubscribe = subscribeDisclosures(disclosure => {
      if (group !== 'all' && disclosure.group !== group) return
      setItems(previous => mergeDisclosures(previous, [disclosure]))
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [group])

  return { items, status, scope }
}

export interface CapitalBucket {
  date: string
  dilution: number
  shareholderReturn: number
  treasuryDisposal: number
  dilutionCount: number
  shareholderReturnCount: number
  treasuryDisposalCount: number
  missingAmountCount: number
}

export interface CapitalEvents {
  bucket: 'day' | 'week'
  buckets: CapitalBucket[]
  top: DisclosureItem[]
  since: string | null
}

export function useCapitalEvents(range: string) {
  const [data, setData] = useState<CapitalEvents | null>(null)
  const [status, setStatus] = useState<ChartStatus>('loading')

  useEffect(() => {
    let cancelled = false
    setData(null)
    setStatus('loading')
    fetch(`${DISCLOSURES_URL}/capital-events?range=${encodeURIComponent(range)}`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(body => {
        if (cancelled) return
        setData({
          bucket: body?.bucket === 'week' ? 'week' : 'day',
          buckets: Array.isArray(body?.buckets) ? body.buckets : [],
          top: Array.isArray(body?.top) ? body.top : [],
          since: typeof body?.since === 'string' ? body.since : null,
        })
        setStatus('loaded')
      })
      .catch(err => {
        if (cancelled) return
        console.error('Failed to fetch capital events', err)
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [range])

  return { data, status }
}
