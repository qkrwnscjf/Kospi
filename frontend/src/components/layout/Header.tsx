import { cn } from '@/lib/utils'
import { LayoutDashboard, Globe, TrendingUp, Activity, Terminal, Sun, Moon } from 'lucide-react'
import { motion } from 'framer-motion'
import { useConnectionStatus, useLatestTick } from '@/hooks/useMarketData'
import { useTheme } from '@/lib/theme'
import { formatNumber } from '@/lib/format'
import type { TickData } from '@/lib/marketSocket'

const CATEGORIES = [
  { id: 'category1', name: '국내 전광판', icon: LayoutDashboard },
  { id: 'category2', name: '매크로 및 환율', icon: Globe },
  { id: 'category3', name: '글로벌 연동', icon: TrendingUp },
  { id: 'category4', name: '국내 섹터 모멘텀', icon: Activity },
]

interface HeaderProps {
  activeCategory: string
  onCategoryChange: (id: string) => void
}

// 상단 지수 표시. 색은 등락 기준이다 (T-33: 이전에는 KOSPI는 항상 초록, 원/달러는 항상 빨강이었음).
// 값이 없으면 "로딩중..."을 계속 깜빡이지 않고 "—"로 둔다.
function HeaderQuote({ label, tick }: { label: string; tick: TickData | null }) {
  const color = !tick ? 'text-fg-muted' : tick.changeRate > 0 ? 'text-up' : tick.changeRate < 0 ? 'text-down' : 'text-fg'
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-medium text-fg-muted">{label}</span>
      <span className={cn('text-xs font-semibold tabular-nums', color)}>{tick ? formatNumber(tick.price, 2) : '—'}</span>
    </div>
  )
}

// 실제 WebSocket 연결 상태 (T-33). 이전에는 연결과 상관없이 "Live"가 항상 깜빡였다.
function ConnectionIndicator() {
  const status = useConnectionStatus()
  const label = status === 'connected' ? '실시간' : status === 'disconnected' ? '연결 끊김' : '연결 중'
  return (
    <div className="flex items-center gap-2" title={`실시간 연결: ${label}`}>
      <span className="relative flex h-1.5 w-1.5">
        {status === 'connected' && <span className="absolute inset-0 rounded-full bg-fg opacity-60 motion-safe:animate-ping" />}
        <span className={cn('relative h-1.5 w-1.5 rounded-full', status === 'connected' ? 'bg-fg' : status === 'disconnected' ? 'bg-down' : 'bg-fg-muted')} />
      </span>
      <span className={cn('text-[11px] font-medium', status === 'disconnected' ? 'text-down' : 'text-fg-muted')}>{label}</span>
    </div>
  )
}

// 라이트·다크 전환 버튼 (T-54). 기본은 라이트.
function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const label = theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface text-fg transition-colors hover:border-line-strong"
    >
      {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  )
}

export function Header({ activeCategory, onCategoryChange }: HeaderProps) {
  // 공유 소켓으로 최신값만 받는다 (T-24)
  const kospi = useLatestTick('KOSPI')
  const usdKrw = useLatestTick('USD/KRW')

  return (
    <header className="relative flex w-full flex-col items-center pb-8 pt-16">
      {/* 오른쪽 위: 지수 · 연결 상태 · 테마 전환 */}
      <div className="absolute right-4 top-5 z-50 flex items-center gap-3 md:right-8">
        <div className="hidden items-center gap-4 rounded-full border border-line bg-surface px-4 py-1.5 md:flex">
          <HeaderQuote label="KOSPI" tick={kospi} />
          <div className="h-3 w-px bg-line" />
          <HeaderQuote label="USD/KRW" tick={usdKrw} />
        </div>
        <ConnectionIndicator />
        <ThemeToggle />
      </div>

      {/* Centered Content */}
      <div className="mb-10 mt-4 flex items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-fg">
          <Terminal className="h-6 w-6 text-page" />
        </div>
        <div className="flex flex-col items-start">
          <h1 className="text-2xl font-bold leading-none tracking-tight text-fg">KOSPI Insight</h1>
          <span className="mt-1.5 text-[11px] font-medium text-fg-muted">실시간 시장 대시보드</span>
        </div>
      </div>

      {/* Navigation Categories: 선택된 탭은 흑백 반전 (D-35) */}
      <nav className="flex flex-wrap items-center justify-center gap-1 rounded-2xl border border-line bg-surface p-1.5" aria-label="카테고리">
        {CATEGORIES.map(item => {
          const Icon = item.icon
          const isActive = activeCategory === item.id

          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={isActive}
              onClick={() => onCategoryChange(item.id)}
              className={cn(
                'relative flex items-center gap-2 rounded-xl px-5 py-2.5 transition-colors duration-200',
                isActive ? 'text-page' : 'text-fg-muted hover:bg-fg/5 hover:text-fg'
              )}
            >
              {isActive && (
                <motion.div layoutId="header-active" className="pointer-events-none absolute inset-0 rounded-xl bg-fg" />
              )}
              <Icon className="relative z-10 h-4 w-4" />
              <span className="relative z-10 text-sm font-medium">{item.name}</span>
            </button>
          )
        })}
      </nav>
    </header>
  )
}
