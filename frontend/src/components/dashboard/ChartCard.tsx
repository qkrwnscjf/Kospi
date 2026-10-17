import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { AreaChart, Area, ResponsiveContainer, YAxis, Tooltip, XAxis, CartesianGrid } from 'recharts'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMarketData, type ChartStatus } from '@/hooks/useMarketData'

interface ChartCardProps {
  title: string
  symbol: string
  ready: boolean
}

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

// 1초마다 현재 시각을 갱신한다 (신선도 표시용).
function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

export function ChartCard({ title, symbol, ready }: ChartCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const [isHovered, setIsHovered] = useState(false)
  const [activeRange, setActiveRange] = useState('실시간')
  const now = useNow(1000)

  const { latest, chartData, status } = useMarketData(symbol, activeRange, ready)

  const displayCurrent = latest ? latest.price.toLocaleString() : '—'
  // 등락률은 모든 지표에서 % 단위다 (T-27, P-19: 이전에는 문자열에 % 조건을 걸어서 한 번도 표시되지 않았음)
  const displayChange = latest ? `${latest.changeRate > 0 ? '+' : ''}${latest.changeRate.toFixed(2)}%` : null
  const isUp = latest ? latest.changeRate > 0 : true
  const message = chartMessage(status, chartData.length, activeRange === '실시간')

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return
    const rect = cardRef.current.getBoundingClientRect()
    setMousePos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    })
  }

  // Determine formatting based on title
  const formatYAxis = (value: number) => {
    if (title.includes('환율') || title.includes('USD')) return value.toLocaleString()
    if (title.includes('금리') || title.includes('%')) return `${value.toFixed(2)}%`
    if (title.includes('매수')) return `${(value / 100).toFixed(1)}T`
    if (value > 1000) return value.toLocaleString()
    return value.toFixed(1)
  }

  const formatXAxis = (tickItem: any) => {
    if (typeof tickItem !== 'number') return tickItem;
    const date = new Date(tickItem);
    
    if (activeRange === '실시간') {
      return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
    } else if (activeRange === '1일') {
      return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    } else if (activeRange === '1주' || activeRange === '1개월' || activeRange === '3개월') {
      return `${date.getMonth() + 1}/${date.getDate()}`;
    } else if (activeRange === '1년') {
      return `${date.getFullYear().toString().slice(-2)}/${date.getMonth() + 1}`;
    }
    return tickItem;
  };

  return (
    <motion.div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "relative group h-[340px] rounded-2xl overflow-hidden",
        "bg-gradient-to-b from-white/[0.08] to-white/[0.02]",
        "border border-white/[0.06] hover:border-white/[0.12] transition-colors duration-500",
        "shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_2px_20px_rgba(0,0,0,0.4)]",
        "hover:shadow-[0_0_0_1px_rgba(255,255,255,0.1),0_8px_40px_rgba(0,0,0,0.5),0_0_80px_rgba(94,106,210,0.05)]"
      )}
    >
      {/* Spotlight Effect */}
      <div 
        className="absolute inset-0 transition-opacity duration-500 pointer-events-none"
        style={{
          opacity: isHovered ? 1 : 0,
          background: `radial-gradient(400px circle at ${mousePos.x}px ${mousePos.y}px, rgba(94,106,210,0.1), transparent 80%)`
        }}
      />

      {/* Border Gradient Hover */}
      <div 
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{
          padding: '1px',
          background: `radial-gradient(300px circle at ${mousePos.x}px ${mousePos.y}px, rgba(94,106,210,0.4), transparent 80%)`,
          mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          maskComposite: 'exclude',
          WebkitMaskComposite: 'xor'
        }}
      />

      <div className="relative z-10 p-6 flex flex-col h-full">
        <div className="flex justify-between items-start mb-2">
          <div>
            <h3 className="text-xs font-mono tracking-widest text-foreground-muted uppercase group-hover:text-foreground-subtle transition-colors mb-1">
              {title}
            </h3>
            <div className="text-2xl font-bold text-gradient">
              {displayCurrent}
            </div>
            {latest && (
              <div
                className="text-[10px] font-mono text-foreground-muted mt-0.5"
                title={new Date(latest.timestamp).toLocaleString()}
              >
                기준 {formatAge(now - latest.timestamp)}
              </div>
            )}
          </div>
          {displayChange !== null && (
            <div className={cn(
              "flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border",
              isUp
                ? "text-green-400 bg-green-400/5 border-green-400/20 shadow-[0_0_20px_rgba(74,222,128,0.1)]"
                : "text-red-400 bg-red-400/5 border-red-400/20 shadow-[0_0_20px_rgba(248,113,113,0.1)]"
            )}>
              {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {displayChange}
            </div>
          )}
        </div>

        {/* Time Range Selector */}
        <div className="flex gap-1 mb-4">
          {TIME_RANGES.map((range) => (
            <button
              key={range}
              onClick={(e) => { e.stopPropagation(); setActiveRange(range); }}
              className={cn(
                "text-[10px] px-2 py-1 rounded-md transition-all duration-200",
                activeRange === range 
                  ? "bg-white/10 text-foreground font-medium" 
                  : "text-foreground-muted hover:text-foreground-subtle hover:bg-white/5"
              )}
            >
              {range}
            </button>
          ))}
        </div>

        <div className="flex-1 -mx-2 mb-2 relative">
          {message && (
            <div className="absolute inset-0 z-10 flex items-center justify-center text-xs font-mono tracking-wider text-foreground-muted">
              {message}
            </div>
          )}
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id={`gradient-${title}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={isUp ? "#4ade80" : "#f87171"} stopOpacity={0.15} />
                  <stop offset="100%" stopColor={isUp ? "#4ade80" : "#f87171"} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid 
                strokeDasharray="3 3" 
                vertical={false} 
                stroke="rgba(255,255,255,0.03)" 
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'rgba(10, 10, 12, 0.9)', 
                  borderColor: 'rgba(255, 255, 255, 0.1)',
                  borderRadius: '8px',
                  backdropFilter: 'blur(12px)',
                  fontSize: '11px',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
                }}
                itemStyle={{ color: '#EDEDEF', padding: '2px 0' }}
                labelStyle={{ display: 'none' }}
                cursor={{ stroke: 'rgba(94, 106, 210, 0.3)', strokeWidth: 1 }}
                formatter={(value: any) => [formatYAxis(Number(value)), title]}
              />
              <XAxis 
                dataKey="time"
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'rgba(138, 143, 152, 0.5)', fontSize: 10, fontFamily: 'monospace' }}
                minTickGap={30}
                tickFormatter={formatXAxis}
              />
              <YAxis 
                orientation="right"
                tick={{ fill: 'rgba(138, 143, 152, 0.5)', fontSize: 10, fontFamily: 'monospace' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={formatYAxis}
                domain={['auto', 'auto']}
                width={50}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={isUp ? "#4ade80" : "#f87171"}
                strokeWidth={2}
                fill={`url(#gradient-${title})`}
                isAnimationActive={true}
                /* 1초 애니메이션 동안 새 값이 늦게 그려져서 300ms로 줄였다 (T-27) */
                animationDuration={300}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
      
      {/* Top Edge Highlight */}
      <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
    </motion.div>
  )
}
