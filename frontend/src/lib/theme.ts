import { useCallback, useEffect, useState } from 'react'

// 라이트·다크 전환 (docs/Task_ORDER.md T-54, D-35)
// 기본은 라이트. 선택은 브라우저에 저장하고, 다음 접속 때 index.html의 인라인 스크립트가 화면을 그리기 전에 적용한다.

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'kospi-theme'

const currentTheme = (): Theme => (document.documentElement.classList.contains('dark') ? 'dark' : 'light')

// CSS 색 토큰을 실제 색 문자열로 읽는다 (예: 'up' → 'rgb(21 128 61)'). 막대별 색처럼 currentColor로 칠할 수 없는 SVG에 쓴다.
// 테마(<html class="dark">)가 바뀌면 다시 읽는다.
export function useTokenColors<T extends string>(names: readonly T[]): Record<T, string> {
  const read = () =>
    Object.fromEntries(
      names.map(name => [name, `rgb(${getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim()})`])
    ) as Record<T, string>
  const [colors, setColors] = useState(read)
  useEffect(() => {
    const observer = new MutationObserver(() => setColors(read()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
    // names는 호출하는 곳에서 고정된 배열로 넘긴다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return colors
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(currentTheme)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // 저장할 수 없는 환경(사생활 보호 모드 등)에서도 화면 전환은 동작한다.
    }
  }, [theme])

  const toggle = useCallback(() => setTheme(previous => (previous === 'dark' ? 'light' : 'dark')), [])

  return { theme, toggle }
}
