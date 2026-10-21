// 배경 (docs/Task_ORDER.md T-54 · T-69, D-35 · D-54)
// 이전의 움직이는 blur 원 3개와 노이즈는 제거했다(흑백 디자인, GPU 부담 감소).
// 위쪽에 아주 옅은 격자를 두고, 그 위에 강조색(neon)의 정적인 빛 번짐을 얹는다(움직이지 않음).
// 격자 색은 본문색(currentColor)을 따라 라이트·다크에 맞게 바뀐다.
export function AmbientBackground() {
  return (
    <div aria-hidden className="fixed inset-0 -z-10 bg-page">
      <div className="ambient-glow absolute inset-0" />
      <div className="absolute inset-0 text-fg opacity-[0.05] [background-image:linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(ellipse_60%_45%_at_50%_0%,#000_60%,transparent_100%)]" />
    </div>
  )
}
