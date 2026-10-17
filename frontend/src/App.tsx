import { useState } from 'react'
import { MotionConfig } from 'framer-motion'
import { Header } from '@/components/layout/Header'
import { AmbientBackground } from '@/components/layout/AmbientBackground'
import { DashboardGrid } from '@/components/dashboard/DashboardGrid'

function App() {
  const [activeCategory, setActiveCategory] = useState('category1')

  return (
    // 운영체제에서 "동작 줄이기"를 켠 사용자에게는 등장·전환 애니메이션을 끈다 (T-34)
    <MotionConfig reducedMotion="user">
      <div className="relative min-h-screen w-full overflow-x-hidden font-sans text-fg">
        <AmbientBackground />

        <div className="relative z-10 flex min-h-screen w-full flex-col items-center">
          <Header
            activeCategory={activeCategory}
            onCategoryChange={setActiveCategory}
          />

          <main className="w-full max-w-[1400px] flex-1 px-4 pb-20 md:px-8">
            <DashboardGrid categoryId={activeCategory} />
          </main>
        </div>
      </div>
    </MotionConfig>
  )
}

export default App
