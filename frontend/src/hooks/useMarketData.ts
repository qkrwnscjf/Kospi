import { useEffect, useState, useSyncExternalStore } from 'react'
import { getConnectionStatus, getLastReceivedAt, subscribeStatus, subscribeTicks, type TickData } from '@/lib/marketSocket'
import { appendPoint, mergePoints, type ChartPoint } from '@/lib/chartPoints'

export type { ChartPoint }

// 실시간 연결 상태와 마지막 데이터 수신 시각 (T-33). 공유 소켓 1개의 상태다.
export const useConnectionStatus = () => useSyncExternalStore(subscribeStatus, getConnectionStatus)
export const useLastReceivedAt = () => useSyncExternalStore(subscribeStatus, getLastReceivedAt)

// loading: 불러오는 중, loaded: 응답을 받음(데이터가 0개일 수 있음), not_ready: 수집 보류 중인 지표(R-04), error: 요청 실패
export type ChartStatus = 'loading' | 'loaded' | 'not_ready' | 'error'

const HISTORY_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1/market/history'
// 최근 tick API는 같은 경로 아래에 있다 (T-25)
const RECENT_URL = HISTORY_URL.replace(/history$/, 'recent')

const REALTIME = '실시간'

// 심볼의 최신 tick만 받는다 (Header의 현재가 등). 공유 소켓을 쓰므로 연결이 늘지 않는다 (T-24).
export function useLatestTick(symbol: string, enabled = true) {
  const [latest, setLatest] = useState<TickData | null>(null)
  useEffect(() => {
    if (!enabled) return
    return subscribeTicks(symbol, tick => setLatest(tick))
  }, [symbol, enabled])
  return latest
}

export function useMarketData(symbol: string, timeframe: string, ready: boolean) {
  const [chartData, setChartData] = useState<ChartPoint[]>([])
  const [status, setStatus] = useState<ChartStatus>(ready ? 'loading' : 'not_ready')

  // 현재가와 기준 시각은 타임프레임과 상관없이 실시간 값으로 표시한다 (소켓 1개를 공유하므로 추가 연결이 없음, T-24).
  const latest = useLatestTick(symbol, ready)

  useEffect(() => {
    if (!ready) {
      setChartData([])
      setStatus('not_ready')
      return
    }

    // 타임프레임을 바꾸면 이전 데이터를 비우고 새로 불러온다. 과거 데이터와 실시간 데이터가 섞이지 않는다 (T-27, P-13).
    let cancelled = false
    setChartData([])
    setStatus('loading')

    const isRealtime = timeframe === REALTIME
    // 실시간 차트의 첫 화면은 mock 대신 DB에 있는 실제 최근 tick으로 채운다 (T-25, P-02).
    const url = isRealtime
      ? `${RECENT_URL}?ticker=${encodeURIComponent(symbol)}`
      : `${HISTORY_URL}?ticker=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`

    fetch(url)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(body => {
        if (cancelled) return
        if (body?.status === 'not_ready') {
          setStatus('not_ready')
          return
        }
        const points: ChartPoint[] = Array.isArray(body?.data) ? body.data : []
        setChartData(previous => (isRealtime ? mergePoints(points, previous) : points))
        setStatus('loaded')
      })
      .catch(err => {
        if (cancelled) return
        console.error('Failed to fetch chart data', err)
        setStatus('error')
      })

    if (!isRealtime) {
      return () => {
        cancelled = true
      }
    }

    const unsubscribe = subscribeTicks(symbol, tick => {
      setChartData(previous => appendPoint(previous, { time: tick.timestamp, value: tick.price }))
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [symbol, timeframe, ready])

  return { latest, chartData, status }
}
