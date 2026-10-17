import { cn } from '@/lib/utils'
import { LayoutDashboard, Globe, TrendingUp, Activity, Terminal } from 'lucide-react'
import { motion } from 'framer-motion'
import { useLatestTick } from '@/hooks/useMarketData'

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

export function Header({ activeCategory, onCategoryChange }: HeaderProps) {
  // 이전에는 지표마다 소켓을 따로 열었다. 이제 공유 소켓으로 최신값만 받는다 (T-24).
  const kospiPrice = useLatestTick('KOSPI')?.price;
  const usdPrice = useLatestTick('USD/KRW')?.price;

  return (
    <header className="w-full pt-16 pb-8 relative flex flex-col items-center">
      {/* Absolute top-right indices */}
      <div className="absolute top-6 right-8 hidden md:flex items-center gap-6 z-50">
        <div className="flex items-center gap-4 px-4 py-1.5 bg-white/[0.03] rounded-full border border-white/[0.06] shadow-lg backdrop-blur-md">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-foreground-muted uppercase">KOSPI</span>
            <span className={cn("text-xs font-bold transition-colors duration-300", kospiPrice ? "text-green-400" : "text-gray-400 animate-pulse")}>
              {kospiPrice ? kospiPrice.toLocaleString() : "로딩중..."}
            </span>
          </div>
          <div className="w-[1px] h-3 bg-white/10" />
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-foreground-muted uppercase">USD/KRW</span>
            <span className={cn("text-xs font-bold transition-colors duration-300", usdPrice ? "text-red-400" : "text-gray-400 animate-pulse")}>
              {usdPrice ? usdPrice.toLocaleString() : "로딩중..."}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <div className="w-1.5 h-1.5 bg-green-500 rounded-full" />
            <div className="absolute inset-0 w-1.5 h-1.5 bg-green-500 rounded-full animate-ping opacity-75" />
          </div>
          <span className="text-[9px] font-mono uppercase tracking-widest text-foreground-muted">Live</span>
        </div>
      </div>

      {/* Centered Content */}
      <div className="flex items-center gap-4 mb-10 mt-4">
        <div className="w-12 h-12 rounded-xl bg-accent flex items-center justify-center shadow-[0_0_30px_rgba(94,106,210,0.4)]">
          <Terminal className="w-6 h-6 text-white" />
        </div>
        <div className="flex flex-col items-start">
          <h1 className="text-2xl font-bold text-gradient tracking-tight leading-none">KOSPI Insight</h1>
          <span className="text-[10px] font-mono tracking-[0.2em] text-foreground-muted uppercase mt-1.5">Terminal v1.2.4</span>
        </div>
      </div>

      {/* Navigation Categories */}
      <nav className="flex flex-wrap justify-center items-center gap-2 p-1.5 bg-white/[0.02] border border-white/[0.06] rounded-2xl backdrop-blur-xl shadow-2xl">
        {CATEGORIES.map((item) => {
          const Icon = item.icon
          const isActive = activeCategory === item.id
          
          return (
            <button
              key={item.id}
              onClick={() => onCategoryChange(item.id)}
              className={cn(
                "flex items-center gap-2 px-5 py-2.5 rounded-xl transition-all duration-300 group relative",
                isActive 
                  ? "text-foreground" 
                  : "text-foreground-muted hover:text-foreground hover:bg-white/[0.04]"
              )}
            >
              <Icon className={cn(
                "w-4 h-4 transition-colors duration-300 relative z-10",
                isActive ? "text-accent" : "group-hover:text-foreground"
              )} />
              <span className="font-medium text-sm relative z-10">{item.name}</span>
              
              {isActive && (
                <motion.div 
                  layoutId="header-active"
                  className="absolute inset-0 bg-white/[0.08] border border-accent/20 rounded-xl pointer-events-none shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)]" 
                />
              )}
            </button>
          )
        })}
      </nav>
    </header>
  )
}
