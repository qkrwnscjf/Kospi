import { useEffect, useState } from 'react'
import { subscribeFlows, type InvestorFlowData } from '@/lib/marketSocket'
import { appendFlowPoint, type FlowMarket, type FlowPoint } from '@/lib/flows'
import type { ChartStatus } from '@/hooks/useMarketData'

// 증시 자금 흐름 데이터 (docs/Task_ORDER.md 11단계 A)
// - 최신값: 공유 소켓의 `flows:<시장>` 방 (실시간)
// - 차트: REST `/api/v1/flows/investors`. "1일"은 장중 추이에 실시간 값을 이어 붙이고, 나머지는 거래일별 값

const HISTORY_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1/market/history'
const FLOWS_URL = HISTORY_URL.replace(/market\/history$/, 'flows/investors')

const INTRADAY = '1일'

const toPoint = (flow: InvestorFlowData): FlowPoint => ({
  time: flow.time,
  foreignNet: flow.foreignNet,
  institutionNet: flow.institutionNet,
  individualNet: flow.individualNet,
  status: flow.status,
})

export function useLatestFlow(market: FlowMarket) {
  const [latest, setLatest] = useState<InvestorFlowData | null>(null)
  useEffect(() => subscribeFlows(market, flow => setLatest(flow)), [market])
  return latest
}

export function useInvestorFlows(market: FlowMarket, range: string) {
  const [points, setPoints] = useState<FlowPoint[]>([])
  const [status, setStatus] = useState<ChartStatus>('loading')

  useEffect(() => {
    let cancelled = false
    setPoints([])
    setStatus('loading')

    fetch(`${FLOWS_URL}?market=${encodeURIComponent(market)}&range=${encodeURIComponent(range)}`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(body => {
        if (cancelled) return
        const data: FlowPoint[] = Array.isArray(body?.data) ? body.data : []
        // 응답보다 먼저 온 실시간 값이 있으면 뒤에 이어 붙인다
        setPoints(previous => previous.reduce(appendFlowPoint, data))
        setStatus('loaded')
      })
      .catch(err => {
        if (cancelled) return
        console.error('Failed to fetch investor flows', err)
        setStatus('error')
      })

    if (range !== INTRADAY) {
      return () => {
        cancelled = true
      }
    }

    const unsubscribe = subscribeFlows(market, flow => setPoints(previous => appendFlowPoint(previous, toPoint(flow))))
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [market, range])

  return { points, status }
}
