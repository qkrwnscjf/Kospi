import { useState } from 'react'
import { Header } from '@/components/layout/Header'
import { AmbientBackground } from '@/components/layout/AmbientBackground'
import { DashboardGrid } from '@/components/dashboard/DashboardGrid'

function App() {
  const [activeCategory, setActiveCategory] = useState('category1')

  return (
    <div className="relative min-h-screen w-full font-sans text-foreground overflow-x-hidden">
      <AmbientBackground />
      
      <div className="relative z-10 flex flex-col min-h-screen w-full items-center">
        <Header 
          activeCategory={activeCategory} 
          onCategoryChange={setActiveCategory} 
        />
        
        <main className="flex-1 w-full max-w-[1400px] px-4 md:px-8 pb-20">
          <DashboardGrid categoryId={activeCategory} />
        </main>
      </div>
    </div>
  )
}

export default App
