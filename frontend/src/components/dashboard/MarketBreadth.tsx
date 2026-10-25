import { useState } from 'react'
import { motion } from 'framer-motion'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { cn } from '@/lib/utils'
import { formatDate } from '@/lib/format'
import { useTokenColors } from '@/lib/theme'
import { BREADTH_MARKET_LABELS, BREADTH_MARKETS, breadthShares, formatTradingValue, netAdvancers, type BreadthMarket, type BreadthPoint } from '@/lib/breadth'
import { useMarketBreadth } from '@/hooks/useMarketBreadth'
import type { ChartStatus } from '@/hooks/useMarketData'

// 시장 폭·거래대금 (docs/Task_ORDER.md T-106, D-67)
// 시장별로 최근 거래일의 상승·보합·하락 종목 수 막대와 거래대금, 기간 동안의 순상승 종목 수(상승 − 하락) 막대를 보여 준다.
// 자료: KRX Open API 종목별 일별매매정보를 수집기가 시장별 합계로 줄인 값(종목 행은 저장하지 않음). 하루 1번 갱신.
// 색은 등락 색 규칙(상승 초록·하락 빨강, D-32), 네온 강조색은 데이터에 쓰지 않는다 (D-54).

const RANGES = ['1주', '1개월', '3개월', '1년']
const COLOR_TOKENS = ['up', 'down', 'fg-muted', 'surface', 'line'] as const
const cardClass = 'card-neon flex flex-col rounded-xl border border-line bg-surface p-5'

function statusMessage(status: ChartStatus, empty: boolean) {
  if (status === 'error') return '데이터를 불러오지 못했습니다'
  if (status === 'loading') return '불러오는 중'
  return empty ? '데이터 준비 중 (KRX 일별매매정보 수집 후 표시)' : null
}

function BreadthCard({ market, points, status }: { market: BreadthMarket; points: BreadthPoint[]; status: ChartStatus }) {
  const colors = useTokenColors(COLOR_TOKENS)
  const latest = points[points.length - 1]
  const shares = latest ? breadthShares(latest) : null
  const message = statusMessage(status, points.length === 0)
  const data = points.map(point => ({ ...point, net: netAdvancers(point) }))

  return (
    <div className={cardClass}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-[13px] font-medium text-fg-muted">{BREADTH_MARKET_LABELS[market]}</h3>
          <div className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-fg">
            {latest ? formatTradingValue(latest.tradingValue) : '—'}
            <span className="ml-1.5 text-[11px] font-medium text-fg-muted">거래대금</span>
          </div>
          <div className="mt-0.5 h-4 text-[11px] text-fg-muted tabular-nums">{latest && `기준일 ${formatDate(latest.time, true)} · ${latest.stocks.toLocaleString('ko-KR')}종목`}</div>
        </div>
        <span className="inline-flex shrink-0 items-center rounded-full border border-line px-1.5 py-px text-[10px] font-medium leading-4 text-fg-muted">일별</span>
      </div>

      {/* 최근 거래일: 상승 · 보합 · 하락 비율 막대 (숫자를 함께 적어 색만으로 구분하지 않음) */}
      <div className="mb-1 flex h-2.5 w-full overflow-hidden rounded-full bg-fg/5" aria-hidden>
        {shares && (
          <>
            <span style={{ width: `${shares.up}%`, backgroundColor: colors.up }} />
            <span style={{ width: `${shares.flat}%`, backgroundColor: colors['fg-muted'], opacity: 0.4 }} />
            <span style={{ width: `${shares.down}%`, backgroundColor: colors.down }} />
          </>
        )}
      </div>
      <div className="mb-4 flex justify-between text-[11px] tabular-nums">
        <span className="text-up">상승 {latest ? latest.advancers.toLocaleString('ko-KR') : '—'}</span>
        <span className="text-fg-muted">보합 {latest ? latest.unchanged.toLocaleString('ko-KR') : '—'}</span>
        <span className="text-down">하락 {latest ? latest.decliners.toLocaleString('ko-KR') : '—'}</span>
      </div>

      <h4 className="mb-1 text-[11px] font-medium text-fg-muted">순상승 종목 수 (상승 − 하락)</h4>
      <div className="relative -mx-2 h-[160px] text-fg">
        {message && <div className="absolute inset-0 z-10 flex items-center justify-center px-4 text-center text-xs text-fg-muted">{message}</div>}
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 8, left: -12, bottom: 0 }} barCategoryGap="15%">
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" strokeOpacity={0.08} />
            <XAxis dataKey="time" axisLine={false} tickLine={false} minTickGap={24}
              tick={{ fill: 'currentColor', fillOpacity: 0.55, fontSize: 10 }}
              tickFormatter={(time: unknown) => (typeof time === 'number' ? formatDate(time) : '')} />
            <YAxis orientation="right" axisLine={false} tickLine={false} width={48}
              tick={{ fill: 'currentColor', fillOpacity: 0.55, fontSize: 10 }}
              tickFormatter={(value: number) => Math.round(value).toLocaleString('ko-KR')} />
            <Tooltip
              contentStyle={{ backgroundColor: colors.surface, border: `1px solid ${colors.line}`, borderRadius: 8, fontSize: 11, boxShadow: 'none' }}
              labelFormatter={(time: unknown) => (typeof time === 'number' ? formatDate(time, true) : '')}
              formatter={(_value: unknown, _name: unknown, entry: { payload?: BreadthPoint }) => {
                const point = entry?.payload
                if (!point) return ['—', '']
                return [`상승 ${point.advancers} · 하락 ${point.decliners} · 보합 ${point.unchanged} · 거래대금 ${formatTradingValue(point.tradingValue)}`, '순상승']
              }}
              cursor={{ fill: 'currentColor', fillOpacity: 0.04 }}
            />
            <Bar dataKey="net" radius={[3, 3, 0, 0]} maxBarSize={14} isAnimationActive={false}>
              {data.map(point => <Cell key={point.time} fill={point.net >= 0 ? colors.up : colors.down} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export function MarketBreadthPanel() {
  const [range, setRange] = useState('1개월')
  const { data, status } = useMarketBreadth(range)

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="w-full"
      aria-label="시장 폭 · 거래대금"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[12px] font-semibold tracking-wide text-fg-muted">
          시장 폭 · 거래대금 <span className="text-[11px] font-normal">(KRX 일별매매정보, 장 마감 후 갱신)</span>
        </h3>
        <div className="flex gap-1" role="group" aria-label="시장 폭 기간 선택">
          {RANGES.map(item => (
            <button key={item} type="button" aria-pressed={range === item} onClick={() => setRange(item)}
              className={cn('rounded-md px-2 py-1 text-[11px] transition-colors duration-150',
                range === item ? 'bg-fg font-medium text-page' : 'text-fg-muted hover:bg-fg/5 hover:text-fg')}>
              {item}
            </button>
          ))}
        </div>
      </div>
      <div className="grid w-full grid-cols-1 gap-5 md:grid-cols-2">
        {BREADTH_MARKETS.map(market => <BreadthCard key={market} market={market} points={data?.[market] ?? []} status={status} />)}
      </div>
    </motion.section>
  )
}
