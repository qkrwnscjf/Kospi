import { useEffect, useState } from 'react'
import { toMarketRisk, type MarketRisk } from '@/lib/risk'
import type { ChartStatus } from '@/hooks/useMarketData'

// 시장 연관성·리스크 (docs/Task_ORDER.md T-110): REST `/api/v1/market/risk?range=`
const HISTORY_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1/market/history'
const RISK_URL = HISTORY_URL.replace(/history$/, 'risk')

export function useMarketRisk(range: string) {
  const [data, setData] = useState<MarketRisk | null>(null)
  const [status, setStatus] = useState<ChartStatus>('loading')

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    fetch(`${RISK_URL}?range=${encodeURIComponent(range)}`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(body => {
        if (cancelled) return
        const parsed = toMarketRisk(body)
        setData(parsed)
        setStatus(parsed ? 'loaded' : 'error')
      })
      .catch(err => {
        if (cancelled) return
        console.error('Failed to fetch market risk', err)
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [range])

  return { data, status }
}
