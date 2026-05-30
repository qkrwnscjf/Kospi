import { cn } from '@/lib/utils'
import { LayoutDashboard, Globe, TrendingUp, Activity, Terminal } from 'lucide-react'
import { motion } from 'framer-motion'

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
  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/[0.06] bg-background-base/80 backdrop-blur-xl">
      <div className="max-w-[1400px] mx-auto px-8 h-20 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center shadow-[0_0_20px_rgba(94,106,210,0.4)]">
              <Terminal className="w-5 h-5 text-white" />
            </div>
            <div className="flex flex-col">
              <h1 className="text-lg font-bold text-gradient tracking-tight leading-none">KOSPI Insight</h1>
              <span className="text-[9px] font-mono tracking-[0.2em] text-foreground-muted uppercase mt-1">Terminal v1.2.4</span>
            </div>
          </div>

          <nav className="flex items-center gap-1 ml-4">
            {CATEGORIES.map((item) => {
              const Icon = item.icon
              const isActive = activeCategory === item.id
              
              return (
                <button
                  key={item.id}
                  onClick={() => onCategoryChange(item.id)}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-xl transition-all duration-300 group relative",
                    isActive 
                      ? "text-foreground" 
                      : "text-foreground-muted hover:text-foreground hover:bg-white/[0.02]"
                  )}
                >
                  <Icon className={cn(
                    "w-4 h-4 transition-colors duration-300",
                    isActive ? "text-accent" : "group-hover:text-foreground"
                  )} />
                  <span className="font-medium text-sm">{item.name}</span>
                  
                  {isActive && (
                    <motion.div 
                      layoutId="header-active"
                      className="absolute inset-0 bg-white/[0.06] border border-accent/20 rounded-xl pointer-events-none" 
                    />
                  )}
                </button>
              )
            })}
          </nav>
        </div>

        <div className="flex items-center gap-6">
          <div className="hidden md:flex items-center gap-4 px-4 py-1.5 bg-white/[0.03] rounded-full border border-white/[0.06]">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-foreground-muted uppercase">KOSPI</span>
              <span className="text-xs font-bold text-green-400">2,623.29</span>
            </div>
            <div className="w-[1px] h-3 bg-white/10" />
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-foreground-muted uppercase">USD/KRW</span>
              <span className="text-xs font-bold text-red-400">1,372.5</span>
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
      </div>
    </header>
  )
}
