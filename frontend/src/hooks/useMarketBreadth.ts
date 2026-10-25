import { useEffect, useState } from 'react'
import type { BreadthMarket, BreadthPoint } from '@/lib/breadth'
import type { ChartStatus } from '@/hooks/useMarketData'

// 시장 폭·거래대금 (docs/Task_ORDER.md T-106): REST `/api/v1/market/breadth?range=`
const HISTORY_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1/market/history'
const BREADTH_URL = HISTORY_URL.replace(/history$/, 'breadth')

export type BreadthData = Record<BreadthMarket, BreadthPoint[]>

export function useMarketBreadth(range: string) {
  const [data, setData] = useState<BreadthData | null>(null)
  const [status, setStatus] = useState<ChartStatus>('loading')

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    fetch(`${BREADTH_URL}?range=${encodeURIComponent(range)}`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(body => {
        if (cancelled) return
        const raw = body?.data
        setData({
          KOSPI: Array.isArray(raw?.KOSPI) ? raw.KOSPI : [],
          KOSDAQ: Array.isArray(raw?.KOSDAQ) ? raw.KOSDAQ : [],
        })
        setStatus('loaded')
      })
      .catch(err => {
        if (cancelled) return
        console.error('Failed to fetch market breadth', err)
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [range])

  return { data, status }
}
