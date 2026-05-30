import { useState } from 'react'
import { Header } from '@/components/layout/Header'
import { AmbientBackground } from '@/components/layout/AmbientBackground'
import { DashboardGrid } from '@/components/dashboard/DashboardGrid'

function App() {
  const [activeCategory, setActiveCategory] = useState('category1')

  return (
    <div className="relative min-h-screen w-full">
      <AmbientBackground />
      
      <div className="relative z-10 flex flex-col min-h-screen w-full">
        <Header 
          activeCategory={activeCategory} 
          onCategoryChange={setActiveCategory} 
        />
        
        <main className="flex-1 px-8 py-12">
          <DashboardGrid categoryId={activeCategory} />
        </main>
      </div>
    </div>
  )
}

export default App
