// 시장별 정규 거래 시간 — 화면 표시용 (docs/Task_ORDER.md T-42, D-36)
// backend/src/infrastructure/ingestion/market-hours.ts와 같은 규칙이다. 규칙을 바꾸면 두 파일을 함께 고친다.
// 서버에 묻지 않고 브라우저의 Intl로 판단해서, 장 상태를 보여 주려고 요청이 늘지 않는다.
// 공휴일은 반영하지 않는다(공휴일에도 "장중"으로 보일 수 있음).

export type MarketId = 'krx' | 'us_equity' | 'global_24h'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const formatters = new Map<string, Intl.DateTimeFormat>()

// 주어진 시간대의 요일(0=일요일)과 자정 이후 분(minute)
function zonedClock(date: Date, timeZone: string) {
  let formatter = formatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    formatters.set(timeZone, formatter)
  }
  const parts = formatter.formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? ''
  return { day: WEEKDAYS.indexOf(part('weekday')), minutes: Number(part('hour')) * 60 + Number(part('minute')) }
}

const isWeekday = (day: number) => day >= 1 && day <= 5
const hm = (hour: number, minute = 0) => hour * 60 + minute

export function isMarketOpen(market: MarketId, now: Date): boolean {
  if (market === 'krx') {
    // KOSPI, KOSDAQ: 월~금 09:00 ~ 15:30 (서울)
    const { day, minutes } = zonedClock(now, 'Asia/Seoul')
    return isWeekday(day) && minutes >= hm(9) && minutes < hm(15, 30)
  }
  const { day, minutes } = zonedClock(now, 'America/New_York')
  if (market === 'us_equity') {
    // SP500, NASDAQ, SOX, US10Y: 월~금 09:30 ~ 16:00 (뉴욕)
    return isWeekday(day) && minutes >= hm(9, 30) && minutes < hm(16)
  }
  // USD/KRW, DXY, WTI, COPPER: 일 18:00 ~ 금 17:00 (뉴욕)
  if (day === 6) return false
  if (day === 0) return minutes >= hm(18)
  if (day === 5) return minutes < hm(17)
  return true
}
