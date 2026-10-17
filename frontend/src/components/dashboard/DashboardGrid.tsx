import { CATEGORY_DATA } from '@/constants/data'
import { ChartCard } from './ChartCard'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import { formatClock } from '@/lib/format'
import { useConnectionStatus, useLastReceivedAt } from '@/hooks/useMarketData'

interface DashboardGridProps {
  categoryId: string
}

const categoryNames: Record<string, string> = {
  category1: '국내 전광판',
  category2: '매크로 및 환율',
  category3: '글로벌 연동',
  category4: '국내 섹터 모멘텀',
}

// 하단 상태 표시는 고정 문구가 아니라 실제 연결 상태와 마지막 수신 시각을 보여 준다 (T-33).
// 이전에는 항상 "All Systems Operational"과 화면을 그린 시각을 보여 줬다.
const STATUS_TEXT = {
  connecting: '연결 중',
  connected: '실시간 연결됨',
  disconnected: '연결 끊김 · 재연결 중',
} as const

function StatusFooter() {
  const status = useConnectionStatus()
  const lastReceivedAt = useLastReceivedAt()

  return (
    <footer className="mt-24 flex w-full flex-col items-center justify-between gap-6 border-t border-line pb-16 pt-10 md:flex-row">
      <div className="flex items-center gap-8">
        <div className="flex flex-col items-center gap-1 md:items-start">
          <span className="text-[11px] font-medium text-fg-muted">연결 상태</span>
          <div className="flex items-center gap-2">
            <div
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                status === 'connected' ? 'bg-fg' : status === 'disconnected' ? 'bg-down' : 'bg-fg-muted'
              )}
            />
            <span className={cn('text-xs font-medium', status === 'disconnected' && 'text-down')}>{STATUS_TEXT[status]}</span>
          </div>
        </div>
        <div className="flex flex-col items-center gap-1 md:items-start">
          <span className="text-[11px] font-medium text-fg-muted">마지막 데이터 수신</span>
          <span className="text-xs font-medium tabular-nums">{lastReceivedAt ? formatClock(lastReceivedAt) : '—'}</span>
        </div>
      </div>

      <span className="text-[11px] text-fg-muted">시세 출처: Yahoo Finance · 일부 지표는 10~15분 지연 시세</span>
    </footer>
  )
}

export function DashboardGrid({ categoryId }: DashboardGridProps) {
  const charts = CATEGORY_DATA[categoryId] || []
  // 카드가 모두 수집 보류 중인 카테고리는 이유를 먼저 알려 준다 (T-44)
  const allPending = charts.length > 0 && charts.every(chart => !chart.ready)

  return (
    <div className="flex w-full flex-col items-center">
      <header className="mb-12 mt-6 flex flex-col items-center text-center">
        <div className="mb-5 flex items-center gap-3">
          <div className="h-px w-10 bg-line" />
          <span className="text-[11px] font-semibold tracking-[0.25em] text-fg-muted">MARKET OVERVIEW</span>
          <div className="h-px w-10 bg-line" />
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={categoryId}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col items-center"
          >
            <h2 className="mb-3 text-3xl font-bold tracking-tight text-fg md:text-4xl">
              {categoryNames[categoryId]}
            </h2>
            <p className="max-w-2xl px-4 text-xs leading-relaxed text-fg-muted md:text-sm">
              실시간 시장 데이터를 기반으로 한 종합 모니터링 대시보드입니다.
              {categoryId === 'category4'
                ? ' 국내 주요 섹터의 모멘텀을 한눈에 파악하고 비교할 수 있습니다.'
                : ' 주요 지표의 추세와 변동성을 정밀하게 분석합니다.'}
            </p>
          </motion.div>
        </AnimatePresence>
      </header>

      {allPending && (
        <div className="mb-6 w-full rounded-xl border border-dashed border-line px-4 py-3 text-center text-xs text-fg-muted">
          이 카테고리의 지표는 데이터 수집을 준비하고 있습니다. 준비가 끝나면 실제 값이 표시됩니다.
        </div>
      )}

      <motion.div
        layout
        className={cn(
          'grid w-full gap-5',
          categoryId === 'category4'
            ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
            : 'grid-cols-1 md:grid-cols-2'
        )}
      >
        <AnimatePresence mode="popLayout">
          {charts.map((chart, index) => (
            <motion.div
              key={`${categoryId}-${chart.symbol}`}
              layout
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{
                duration: 0.4,
                delay: index * 0.04,
                ease: [0.16, 1, 0.3, 1],
              }}
              className={cn(categoryId === 'category4' && index === 0 ? 'lg:col-span-2 lg:row-span-1' : '')}
            >
              <ChartCard {...chart} />
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>

      <StatusFooter />
    </div>
  )
}
