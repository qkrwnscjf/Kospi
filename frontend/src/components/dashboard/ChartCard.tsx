import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { AreaChart, Area, ResponsiveContainer, YAxis, Tooltip, XAxis, CartesianGrid } from 'recharts'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatAxisNumber, formatClock, formatDate, formatNumber } from '@/lib/format'
import { isMarketOpen, type MarketId } from '@/lib/marketHours'
import { useMarketData, type ChartPoint, type ChartStatus } from '@/hooks/useMarketData'
import type { ChartCardConfig } from '@/constants/data'

const TIME_RANGES = ['실시간', '1일', '1주', '1개월', '3개월', '1년']

// 데이터 신선도 표시 (docs/Task_ORDER.md T-27): 마지막 값의 소스 기준 시각이 지금으로부터 얼마나 지났는지.
function formatAge(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}초 전`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}분 전`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}시간 전`
  return `${Math.floor(hours / 24)}일 전`
}

// 차트 영역에 데이터 대신 보여 줄 안내 문구. 데이터가 있으면 null.
function chartMessage(status: ChartStatus, points: number, isRealtime: boolean) {
  if (status === 'not_ready') return '데이터 준비 중' // T-26, R-04
  if (status === 'error') return '데이터를 불러오지 못했습니다'
  if (points > 0) return null
  if (status === 'loading') return '불러오는 중'
  return isRealtime ? '실시간 데이터 수신 대기 중' : '표시할 데이터가 없습니다'
}

// X축 눈금 (타임프레임별)
function formatXAxis(time: number, range: string) {
  if (range === '실시간') return formatClock(time)
  if (range === '1일') return formatClock(time, false)
  if (range === '1년') return formatDate(time, true).slice(2)
  return formatDate(time)
}

// 툴팁에는 날짜와 시각을 함께 보여 준다 (T-35)
function formatTooltipTime(time: number, range: string) {
  if (range === '실시간') return `${formatDate(time)} ${formatClock(time)}`
  if (range === '1일' || range === '1주') return `${formatDate(time)} ${formatClock(time, false)}`
  return formatDate(time, true)
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

// 1초마다 바뀌는 부분만 따로 그린다 (T-34). 이전에는 카드 전체(차트 포함)가 1초마다 다시 그려졌다.
function Freshness({ timestamp }: { timestamp: number }) {
  const now = useNow(1000)
  return <span title={new Date(timestamp).toLocaleString('ko-KR')}>기준 {formatAge(now - timestamp)}</span>
}

const badgeClass = 'inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-medium leading-4'

// 장 상태 (T-42). 1분마다 다시 판단한다. 공휴일은 반영하지 않는다.
function MarketBadge({ market }: { market: MarketId }) {
  const now = useNow(60_000)
  const open = isMarketOpen(market, new Date(now))
  return (
    <span className={cn(badgeClass, open ? 'border-fg/30 text-fg' : 'border-line text-fg-muted')}>
      <span className={cn('h-1.5 w-1.5 rounded-full', open ? 'bg-fg' : 'bg-fg-muted/50')} />
      {open ? '장중' : '장 마감'}
    </span>
  )
}

type Direction = 'up' | 'down' | 'flat'

// 등락 색은 미국식(상승 초록, 하락 빨강, D-32). 등락 0은 중립 (T-43)
const DIRECTION_STYLE: Record<Direction, string> = {
  up: 'text-up bg-up/10',
  down: 'text-down bg-down/10',
  flat: 'text-fg-muted bg-fg/5',
}
const DIRECTION_ICON = { up: TrendingUp, down: TrendingDown, flat: Minus }

// 그래프 선·채우기 색 (D-37): 상승 초록, 하락 빨강, 변화 없음은 본문색
const CHART_COLOR: Record<Direction, string> = { up: 'text-up', down: 'text-down', flat: 'text-fg' }

// 그래프에 보이는 기간의 방향: 첫 값 대비 마지막 값
function periodDirection(points: ChartPoint[]): Direction | null {
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last || points.length < 2) return null
  return last.value > first.value ? 'up' : last.value < first.value ? 'down' : 'flat'
}

export function ChartCard({ title, symbol, ready, decimals, prefix, suffix, market, delayMinutes }: ChartCardConfig) {
  const [activeRange, setActiveRange] = useState('실시간')
  const { latest, chartData, status } = useMarketData(symbol, activeRange, ready)

  const direction: Direction | null = latest ? (latest.changeRate > 0 ? 'up' : latest.changeRate < 0 ? 'down' : 'flat') : null
  const DirectionIcon = direction ? DIRECTION_ICON[direction] : null
  const message = chartMessage(status, chartData.length, activeRange === '실시간')
  // SVG id에는 공백·괄호가 들어가면 안 되므로 심볼로 만든다 (T-35: 이전에는 제목을 써서 일부 카드에서 채우기가 적용되지 않았음)
  const gradientId = `chart-fill-${symbol.replace(/[^A-Za-z0-9_-]/g, '_')}`
  // 실시간은 등락 배지와 같은 기준(전일 대비)을 써서, 짧은 구간의 흔들림으로 색이 계속 바뀌지 않게 한다.
  // 1일 ~ 1년은 그래프에 보이는 기간의 등락을 따른다.
  const chartDirection = activeRange === '실시간' ? direction : periodDirection(chartData)
  const chartColor = chartDirection ? CHART_COLOR[chartDirection] : 'text-fg'

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="relative h-[340px] rounded-xl border border-line bg-surface transition-colors duration-200 hover:border-line-strong"
    >
      <div className="flex h-full flex-col p-5">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              <h3 className="text-[13px] font-medium text-fg-muted">{title}</h3>
              {ready && market && <MarketBadge market={market} />}
              {ready && delayMinutes && (
                <span className={cn(badgeClass, 'border-line text-fg-muted')} title={`소스가 약 ${delayMinutes}분 늦은 시세를 제공합니다`}>
                  지연 {delayMinutes}분
                </span>
              )}
            </div>
            <div className="flex items-baseline gap-1 text-2xl font-semibold tracking-tight text-fg tabular-nums">
              {latest ? (
                <>
                  {prefix && <span className="text-base font-medium text-fg-muted">{prefix}</span>}
                  {formatNumber(latest.price, decimals)}
                  {suffix && <span className="text-xs font-medium text-fg-muted">{suffix}</span>}
                </>
              ) : (
                <span className="text-fg-muted">—</span>
              )}
            </div>
            <div className="mt-0.5 h-4 text-[11px] text-fg-muted tabular-nums">
              {latest && <Freshness timestamp={latest.timestamp} />}
            </div>
          </div>
          {latest && direction && DirectionIcon && (
            <div className={cn('flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold tabular-nums', DIRECTION_STYLE[direction])}>
              <DirectionIcon className="h-3 w-3" aria-hidden />
              {/* 등락률은 모든 지표에서 % 단위다 (T-27, P-19) */}
              {latest.changeRate > 0 ? '+' : ''}{latest.changeRate.toFixed(2)}%
            </div>
          )}
        </div>

        {/* Time Range Selector: 선택된 항목은 흑백 반전 (D-35) */}
        <div className="mb-3 flex gap-1" role="group" aria-label={`${title} 기간 선택`}>
          {TIME_RANGES.map(range => (
            <button
              key={range}
              type="button"
              aria-pressed={activeRange === range}
              onClick={() => setActiveRange(range)}
              className={cn(
                'rounded-md px-2 py-1 text-[11px] transition-colors duration-150',
                activeRange === range ? 'bg-fg font-medium text-page' : 'text-fg-muted hover:bg-fg/5 hover:text-fg'
              )}
            >
              {range}
            </button>
          ))}
        </div>

        {/* 격자·축·커서는 currentColor(본문색), 선·채우기는 등락 색 클래스를 따로 받는다. 모두 라이트·다크에 맞게 바뀐다 */}
        <div className="relative -mx-2 flex-1 text-fg">
          {message && (
            <div className="absolute inset-0 z-10 flex items-center justify-center text-xs text-fg-muted">
              {message}
            </div>
          )}
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" className={chartColor} stopColor="currentColor" stopOpacity={0.18} />
                  <stop offset="100%" className={chartColor} stopColor="currentColor" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" strokeOpacity={0.08} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgb(var(--color-surface))',
                  border: '1px solid rgb(var(--color-line))',
                  borderRadius: '8px',
                  fontSize: '11px',
                  boxShadow: 'none',
                }}
                itemStyle={{ color: 'rgb(var(--color-fg))', padding: '2px 0' }}
                labelStyle={{ color: 'rgb(var(--color-fg-muted))', marginBottom: '2px' }}
                labelFormatter={(label: unknown) => (typeof label === 'number' ? formatTooltipTime(label, activeRange) : '')}
                cursor={{ stroke: 'currentColor', strokeOpacity: 0.25, strokeWidth: 1 }}
                formatter={(value: unknown) => [`${prefix ?? ''}${formatNumber(Number(value), decimals)}${suffix ? ` ${suffix}` : ''}`, title]}
              />
              <XAxis
                dataKey="time"
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'currentColor', fillOpacity: 0.55, fontSize: 10 }}
                minTickGap={30}
                tickFormatter={(time: unknown) => (typeof time === 'number' ? formatXAxis(time, activeRange) : String(time))}
              />
              <YAxis
                orientation="right"
                tick={{ fill: 'currentColor', fillOpacity: 0.55, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(value: number) => formatAxisNumber(value, decimals)}
                domain={['auto', 'auto']}
                width={60}
              />
              <Area
                type="monotone"
                dataKey="value"
                className={chartColor}
                stroke="currentColor"
                strokeWidth={1.5}
                fill={`url(#${gradientId})`}
                isAnimationActive={true}
                /* 1초 애니메이션 동안 새 값이 늦게 그려져서 300ms로 줄였다 (T-27) */
                animationDuration={300}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </motion.div>
  )
}
