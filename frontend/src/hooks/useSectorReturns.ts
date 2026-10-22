import { useEffect, useState } from 'react'
import type { SectorReturn } from '@/lib/sectors'
import type { ChartStatus } from '@/hooks/useMarketData'

// 섹터 기간 수익률 (docs/Task_ORDER.md D-66): REST `/api/v1/market/sector-returns?range=`
const HISTORY_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1/market/history'
const SECTOR_RETURNS_URL = HISTORY_URL.replace(/history$/, 'sector-returns')

export function useSectorReturns(range: string) {
  const [data, setData] = useState<SectorReturn[]>([])
  const [status, setStatus] = useState<ChartStatus>('loading')

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    fetch(`${SECTOR_RETURNS_URL}?range=${encodeURIComponent(range)}`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(body => {
        if (cancelled) return
        setData(Array.isArray(body?.data) ? body.data : [])
        setStatus('loaded')
      })
      .catch(err => {
        if (cancelled) return
        console.error('Failed to fetch sector returns', err)
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [range])

  return { data, status }
}
