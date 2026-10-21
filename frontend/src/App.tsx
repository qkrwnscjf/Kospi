import { useState } from 'react'
import { MotionConfig } from 'framer-motion'
import { Sidebar } from '@/components/layout/Header'
import { AmbientBackground } from '@/components/layout/AmbientBackground'
import { DashboardGrid } from '@/components/dashboard/DashboardGrid'

function App() {
  const [activeCategory, setActiveCategory] = useState('category1')

  return (
    // 운영체제에서 "동작 줄이기"를 켠 사용자에게는 등장·전환 애니메이션을 끈다 (T-34)
    <MotionConfig reducedMotion="user">
      {/* overflow-x-clip: hidden과 달리 스크롤 영역을 만들지 않아 사이드바의 sticky가 동작한다 (T-68) */}
      <div className="relative min-h-screen w-full overflow-x-clip font-sans text-fg">
        <AmbientBackground />

        {/* 데스크톱은 왼쪽 사이드바 + 본문, 모바일은 위쪽 메뉴 + 본문 (T-68, D-54) */}
        <div className="relative z-10 flex min-h-screen w-full flex-col lg:flex-row">
          <Sidebar
            activeCategory={activeCategory}
            onCategoryChange={setActiveCategory}
          />

          <main className="mx-auto w-full min-w-0 max-w-[1400px] flex-1 px-4 pb-20 md:px-8">
            <DashboardGrid categoryId={activeCategory} />
          </main>
        </div>
      </div>
    </MotionConfig>
  )
}

export default App
