import { useState } from 'react'
import { motion } from 'framer-motion'
import { ExternalLink, Newspaper } from 'lucide-react'
import { cn } from '@/lib/utils'

// 시장 뉴스 탭 — 레이아웃 미리보기 (docs/Task_ORDER.md 15단계 T-115, D-68)
// 수집(T-110 ~ T-114)은 소스 결정·키 발급 뒤에 연결한다. 지금은 가짜 기사 없이 자리만 보여 준다(mock 데이터 없음, R-04와 같은 원칙).
// 연결 후 표시 규칙: 제목·언론사·"n분 전"·원문 링크(새 창, noopener noreferrer)만. 본문·요약·이미지는 저장·표시하지 않는다.

const REGIONS = [
  {
    key: 'KR',
    label: '국내',
    keywords: ['전체', '코스피', '증시', '환율', '반도체', '금리'],
    sources: ['연합뉴스', '연합인포맥스', '한국경제', '매일경제', '서울경제', '머니투데이', '이데일리', '조선비즈'],
  },
  {
    key: 'GLOBAL',
    label: '해외 (원문)',
    keywords: ['All', 'Stocks', 'Fed', 'Inflation', 'Oil', 'Tech'],
    sources: ['Reuters', 'AP', 'CNBC', 'MarketWatch'],
  },
] as const

const cardClass = 'card-neon flex flex-col rounded-xl border border-line bg-surface p-5'
const PLACEHOLDER_ROWS = 8

// 기사 한 줄의 자리: 언론사 배지 · 제목 · 시각 · 원문 링크 아이콘
function PlaceholderRow({ index }: { index: number }) {
  // 제목 길이를 조금씩 달리해 실제 목록처럼 보이게 한다
  const widths = ['w-11/12', 'w-4/5', 'w-3/4', 'w-5/6', 'w-2/3']
  return (
    <li className="flex items-start gap-3 border-b border-line py-3 last:border-b-0" aria-hidden>
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-center gap-1.5">
          <span className="h-4 w-14 rounded-full border border-line bg-fg/5" />
          <span className="h-3 w-10 rounded bg-fg/5" />
        </div>
        <div className={cn('h-3.5 rounded bg-fg/10', widths[index % widths.length])} />
      </div>
      <ExternalLink className="mt-1 h-3 w-3 shrink-0 text-fg-muted/40" />
    </li>
  )
}

function NewsColumn({ region }: { region: (typeof REGIONS)[number] }) {
  const [keyword, setKeyword] = useState<string>(region.keywords[0])
  return (
    <div className={cardClass}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-medium text-fg-muted">
          {region.label} <span className="text-[11px]">(최근 기사 제목 · 원문 링크)</span>
        </h3>
        <span className="inline-flex items-center rounded-full border border-line px-1.5 py-px text-[10px] font-medium leading-4 text-fg-muted">데이터 준비 중</span>
      </div>
      <div className="no-scrollbar -mx-1 mb-2 flex gap-1 overflow-x-auto px-1" role="group" aria-label={`${region.label} 키워드`}>
        {region.keywords.map(item => (
          <button key={item} type="button" aria-pressed={keyword === item} onClick={() => setKeyword(item)}
            className={cn('shrink-0 rounded-md px-2 py-1 text-[11px] transition-colors duration-150',
              keyword === item ? 'bg-fg font-medium text-page' : 'text-fg-muted hover:bg-fg/5 hover:text-fg')}>
            {item}
          </button>
        ))}
      </div>
      <ul className="flex-1">
        {Array.from({ length: PLACEHOLDER_ROWS }, (_, index) => <PlaceholderRow key={index} index={index} />)}
      </ul>
      <p className="mt-3 text-[11px] leading-relaxed text-fg-muted">
        언론사(초안): {region.sources.join(' · ')}
      </p>
    </div>
  )
}

export function NewsDashboard() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="flex w-full flex-col gap-5"
    >
      <div className="flex items-start gap-3 rounded-xl border border-dashed border-line px-4 py-3 text-xs leading-relaxed text-fg-muted">
        <Newspaper className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          레이아웃 미리보기입니다. 뉴스 수집은 소스 결정과 키 발급 뒤에 연결되며, 그 전에는 기사를 보여 주지 않습니다.
          연결되면 공신력 있는 언론사의 기사 <b className="font-medium text-fg">제목과 원문 링크</b>만 표시하고, 본문·요약·이미지는 저장하거나 보여 주지 않습니다.
        </span>
      </div>
      <div className="grid w-full grid-cols-1 gap-5 lg:grid-cols-2">
        {REGIONS.map(region => <NewsColumn key={region.key} region={region} />)}
      </div>
    </motion.div>
  )
}
