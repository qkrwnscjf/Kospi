import { CATEGORY_DATA } from '@/constants/data'
import { ChartCard } from './ChartCard'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'

interface DashboardGridProps {
  categoryId: string
}

const categoryNames: Record<string, string> = {
  category1: '국내 전광판',
  category2: '매크로 및 환율',
  category3: '글로벌 연동',
  category4: '국내 섹터 모멘텀',
}

export function DashboardGrid({ categoryId }: DashboardGridProps) {
  const charts = CATEGORY_DATA[categoryId] || []

  return (
    <div className="max-w-[1400px] mx-auto">
      <header className="mb-12">
        <div className="flex items-center gap-2 mb-4">
          <div className="h-[1px] w-8 bg-accent" />
          <span className="text-[10px] font-mono tracking-[0.3em] text-accent uppercase font-semibold">Market Overview</span>
        </div>
        
        <AnimatePresence mode="wait">
          <motion.div
            key={categoryId}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            <h2 className="text-4xl md:text-5xl font-bold text-gradient tracking-tight mb-4">
              {categoryNames[categoryId]}
            </h2>
            <p className="text-foreground-muted text-sm md:text-base max-w-2xl leading-relaxed">
              실시간 시장 데이터를 기반으로 한 종합 모니터링 대시보드입니다. 
              {categoryId === 'category4' 
                ? ' 국내 주요 섹터의 모멘텀을 한눈에 파악하고 비교할 수 있습니다.' 
                : ' 주요 지표의 추세와 변동성을 정밀하게 분석합니다.'}
            </p>
          </motion.div>
        </AnimatePresence>
      </header>

      <motion.div 
        layout
        className={cn(
          "grid gap-6",
          categoryId === 'category4' 
            ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" 
            : "grid-cols-1 md:grid-cols-2"
        )}
      >
        <AnimatePresence mode="popLayout">
          {charts.map((chart, index) => (
            <motion.div 
              key={`${categoryId}-${chart.title}`}
              layout
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ 
                duration: 0.4, 
                delay: index * 0.05,
                ease: [0.16, 1, 0.3, 1] 
              }}
              className={cn(
                categoryId === 'category4' && index === 0 ? "lg:col-span-2 lg:row-span-1" : ""
              )}
            >
              <ChartCard {...chart} />
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>
      
      {/* Footer Accent */}
      <footer className="mt-24 pt-12 pb-16 border-t border-white/[0.06] flex flex-col md:flex-row justify-between items-center gap-6">
        <div className="flex items-center gap-8">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-mono tracking-widest text-foreground-subtle uppercase">System Status</span>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-green-500 rounded-full" />
              <span className="text-xs font-medium">All Systems Operational</span>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-mono tracking-widest text-foreground-subtle uppercase">Last Updated</span>
            <span className="text-xs font-medium">{new Date().toLocaleTimeString()}</span>
          </div>
        </div>
        
        <div className="flex items-center gap-4 text-foreground-muted">
          <span className="text-[10px] font-mono tracking-widest uppercase">© 2024 KOSPI Insight Terminal</span>
        </div>
      </footer>
    </div>
  )
}
