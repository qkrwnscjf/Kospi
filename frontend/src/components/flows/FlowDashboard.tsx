import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Sankey, Tooltip, XAxis, YAxis,
} from 'recharts'
import { cn } from '@/lib/utils'
import { formatClock, formatDate } from '@/lib/format'
import { buildSankey, formatEok, INVESTORS, toEok, type FlowMarket, type FlowPoint } from '@/lib/flows'
import { useInvestorFlows, useLatestFlow } from '@/hooks/useInvestorFlows'
import { useTokenColors } from '@/lib/theme'
import type { ChartStatus } from '@/hooks/useMarketData'

// 증시 자금 흐름 탭 (docs/Task_ORDER.md 11단계 A, D-46)
// - 위: "오늘의 수급" 시장 중심 흐름도 (순매도 그룹 → 시장 → 순매수 그룹)
// - 아래: 투자자별 순매수 추이 (1일: 장중 누적 선, 1주 ~ 1년: 거래일별 막대)
// 색은 흑백 토큰(D-35)과 등락 색(D-37)만 쓴다. 투자자는 선 모양·막대 농도로 구분한다.

const MARKETS: { market: FlowMarket; label: string }[] = [
  { market: 'KOSPI', label: '코스피' },
  { market: 'KOSDAQ', label: '코스닥' },
]
const RANGES = ['1일', '1주', '1개월', '3개월', '1년']
const LINE_DASH: Record<string, string | undefined> = { foreignNet: undefined, institutionNet: '6 3', individualNet: '2 3' }
const BAR_OPACITY: Record<string, number> = { foreignNet: 1, institutionNet: 0.7, individualNet: 0.45 }
const COLOR_TOKENS = ['up', 'down', 'fg', 'fg-muted', 'surface', 'line'] as const

const cardClass = 'rounded-xl border border-line bg-surface p-5'
const badgeClass = 'inline-flex items-center rounded-full border border-line px-1.5 py-px text-[10px] font-medium leading-4 text-fg-muted'

const signClass = (value: number) => (value > 0 ? 'text-up' : value < 0 ? 'text-down' : 'text-fg-muted')

function emptyMessage(status: ChartStatus, hasData: boolean, intraday: boolean) {
  if (status === 'error') return '데이터를 불러오지 못했습니다'
  if (hasData) return null
  if (status === 'loading') return '불러오는 중'
  return intraday ? '장중 데이터 수신 대기 중' : '표시할 데이터가 없습니다'
}

// ① 오늘의 수급 (시장 중심 흐름도)
function SupplySummary({ market, label }: { market: FlowMarket; label: string }) {
  const latest = useLatestFlow(market)
  const colors = useTokenColors(COLOR_TOKENS)
  const sankey = latest ? buildSankey(latest, label) : null

  return (
    <div className={cardClass}>
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        <h3 className="text-[13px] font-medium text-fg-muted">{label} 오늘의 수급</h3>
        {latest && <span className={badgeClass}>{latest.status === 'final' ? '확정' : '잠정'}</span>}
        {latest && <span className="text-[11px] text-fg-muted tabular-nums">기준 {formatClock(latest.time, false)}</span>}
      </div>

      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums">
        {INVESTORS.map(investor => (
          <span key={investor.key}>
            <span className="text-fg-muted">{investor.label} </span>
            <span className={cn('font-semibold', latest ? signClass(latest[investor.key]) : 'text-fg-muted')}>
              {latest ? formatEok(latest[investor.key]) : '—'}
            </span>
          </span>
        ))}
      </div>

      <div className="relative h-[180px] text-fg">
        {!sankey ? (
          <div className="flex h-full items-center justify-center text-xs text-fg-muted">
            {latest ? '순매수·순매도가 모두 0입니다' : '장중 데이터 수신 대기 중'}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <Sankey
              data={sankey}
              nodePadding={24}
              nodeWidth={10}
              margin={{ top: 8, right: 90, bottom: 8, left: 90 }}
              link={{ stroke: colors.fg, strokeOpacity: 0.15 }}
              node={(props: any) => {
                const { x, y, width, height, payload } = props
                const side = payload?.side
                const fill = side === 'seller' ? colors.down : side === 'buyer' ? colors.up : colors.fg
                const textX = side === 'seller' ? x - 6 : x + width + 6
                const anchor = side === 'seller' ? 'end' : 'start'
                return (
                  <g>
                    <rect x={x} y={y} width={width} height={height} fill={fill} rx={2} />
                    <text x={textX} y={y + height / 2} dy="0.35em" textAnchor={anchor} fontSize={11} fill={fill}>
                      {payload?.name}
                      {side !== 'market' && ` ${formatEok(payload?.value ?? 0)}`}
                    </text>
                  </g>
                )
              }}
            >
              <Tooltip
                contentStyle={{ backgroundColor: colors.surface, border: `1px solid ${colors.line}`, borderRadius: 8, fontSize: 11, boxShadow: 'none' }}
                formatter={(value: unknown) => formatEok(Number(value))}
              />
            </Sankey>
          </ResponsiveContainer>
        )}
      </div>
      <p className="mt-1 text-[10px] text-fg-muted">순매수 합계 기준이며, 실제 거래 상대를 짝지은 것이 아닙니다.</p>
    </div>
  )
}

// ② 투자자별 순매수 추이
function FlowTrendCard({ market, label }: { market: FlowMarket; label: string }) {
  const [range, setRange] = useState('1일')
  const { points, status } = useInvestorFlows(market, range)
  const colors = useTokenColors(COLOR_TOKENS)
  const intraday = range === '1일'
  const message = emptyMessage(status, points.length > 0, intraday)
  const data = points.map((point: FlowPoint) => ({
    time: point.time,
    foreignNet: toEok(point.foreignNet),
    institutionNet: toEok(point.institutionNet),
    individualNet: toEok(point.individualNet),
  }))
  const formatTime = (time: number) => (intraday ? formatClock(time, false) : formatDate(time, range === '1년'))
  // 두 차트가 함께 쓰는 축·격자·툴팁. Recharts가 자식으로 인식하도록 Fragment 대신 key가 있는 배열로 넘긴다.
  const axes = [
    <CartesianGrid key="grid" strokeDasharray="3 3" vertical={false} stroke="currentColor" strokeOpacity={0.08} />,
    <XAxis key="x" dataKey="time" axisLine={false} tickLine={false} tick={{ fill: 'currentColor', fillOpacity: 0.55, fontSize: 10 }}
      minTickGap={30} tickFormatter={(time: unknown) => (typeof time === 'number' ? formatTime(time) : String(time))} />,
    <YAxis key="y" orientation="right" axisLine={false} tickLine={false} width={56}
      tick={{ fill: 'currentColor', fillOpacity: 0.55, fontSize: 10 }}
      tickFormatter={(value: number) => `${Math.round(value).toLocaleString('ko-KR')}`} />,
    <ReferenceLine key="zero" y={0} stroke="currentColor" strokeOpacity={0.3} />,
    <Tooltip key="tooltip"
      contentStyle={{ backgroundColor: colors.surface, border: `1px solid ${colors.line}`, borderRadius: 8, fontSize: 11, boxShadow: 'none' }}
      labelFormatter={(time: unknown) => (typeof time === 'number' ? formatTime(time) : '')}
      formatter={(value: unknown, name: unknown) => [`${Math.round(Number(value)).toLocaleString('ko-KR')}억`, INVESTORS.find(i => i.key === name)?.label ?? String(name)]}
      cursor={{ fill: 'currentColor', fillOpacity: 0.04, stroke: 'currentColor', strokeOpacity: 0.2 }}
    />,
  ]

  return (
    <div className={cn(cardClass, 'flex h-[360px] flex-col')}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13px] font-medium text-fg-muted">
          {label} 투자자별 순매수 <span className="text-[11px]">(억원{intraday ? ', 장중 누적' : ', 거래일별'})</span>
        </h3>
        {/* 범례: 투자자는 선 모양(1일)·막대 농도(그 외)로 구분 */}
        <div className="flex gap-3 text-[10px] text-fg-muted">
          {INVESTORS.map(investor => (
            <span key={investor.key} className="inline-flex items-center gap-1">
              <svg width="16" height="6" aria-hidden className="text-fg">
                {intraday ? (
                  <line x1="0" y1="3" x2="16" y2="3" stroke="currentColor" strokeWidth="1.5" strokeDasharray={LINE_DASH[investor.key]} />
                ) : (
                  <rect width="16" height="6" fill="currentColor" fillOpacity={BAR_OPACITY[investor.key]} />
                )}
              </svg>
              {investor.label}
            </span>
          ))}
        </div>
      </div>

      <div className="mb-3 flex gap-1" role="group" aria-label={`${label} 기간 선택`}>
        {RANGES.map(item => (
          <button key={item} type="button" aria-pressed={range === item} onClick={() => setRange(item)}
            className={cn('rounded-md px-2 py-1 text-[11px] transition-colors duration-150',
              range === item ? 'bg-fg font-medium text-page' : 'text-fg-muted hover:bg-fg/5 hover:text-fg')}>
            {item}
          </button>
        ))}
      </div>

      <div className="relative -mx-2 flex-1 text-fg">
        {message && (
          <div className="absolute inset-0 z-10 flex items-center justify-center text-xs text-fg-muted">{message}</div>
        )}
        <ResponsiveContainer width="100%" height="100%">
          {intraday ? (
            <LineChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              {axes}
              {INVESTORS.map(investor => (
                <Line key={investor.key} type="monotone" dataKey={investor.key} stroke="currentColor" strokeWidth={1.5}
                  strokeDasharray={LINE_DASH[investor.key]} dot={false} isAnimationActive={false} />
              ))}
            </LineChart>
          ) : (
            <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              {axes}
              {INVESTORS.map(investor => (
                <Bar key={investor.key} dataKey={investor.key} fillOpacity={BAR_OPACITY[investor.key]} isAnimationActive={false}>
                  {data.map(row => (
                    <Cell key={row.time} fill={row[investor.key] >= 0 ? colors.up : colors.down} />
                  ))}
                </Bar>
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export function FlowDashboard() {
  return (
    <div className="flex w-full flex-col gap-5">
      <div className="grid w-full grid-cols-1 gap-5 md:grid-cols-2">
        {MARKETS.map(({ market, label }, index) => (
          <motion.div key={`summary-${market}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: index * 0.04, ease: [0.16, 1, 0.3, 1] }}>
            <SupplySummary market={market} label={label} />
          </motion.div>
        ))}
      </div>
      <div className="grid w-full grid-cols-1 gap-5 md:grid-cols-2">
        {MARKETS.map(({ market, label }, index) => (
          <motion.div key={`trend-${market}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.08 + index * 0.04, ease: [0.16, 1, 0.3, 1] }}>
            <FlowTrendCard market={market} label={label} />
          </motion.div>
        ))}
      </div>
      <p className="text-center text-[11px] text-fg-muted">
        자료: 한국투자증권 Open API (시장별 투자자매매동향, 장중 잠정치). 장 마감 후 확정치는 다음 단계에서 반영됩니다.
      </p>
    </div>
  )
}
