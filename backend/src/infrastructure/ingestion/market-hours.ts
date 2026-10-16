// 시장별 정규 거래 시간 판단 (docs/Task_ORDER.md T-07, D-16)
// 시간대 변환은 Node 내장 Intl을 쓰므로 미국 서머타임도 자동으로 반영된다.
// 공휴일은 반영하지 않는다 (열려 있다고 판단해서 활성 주기로 수집한다).

export type MarketId = 'krx' | 'us_equity' | 'global_24h';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const formatters = new Map<string, Intl.DateTimeFormat>();

// 주어진 시간대의 요일(0=일요일)과 자정 이후 분(minute)을 구한다.
function zonedClock(date: Date, timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? '';
  return {
    day: WEEKDAYS.indexOf(part('weekday')),
    minutes: Number(part('hour')) * 60 + Number(part('minute')),
  };
}

const isWeekday = (day: number) => day >= 1 && day <= 5;
const hm = (hour: number, minute = 0) => hour * 60 + minute;

export const MARKETS: { id: MarketId; isOpen: (now: Date) => boolean }[] = [
  {
    // KOSPI, KOSDAQ: 월~금 09:00 ~ 15:30 (서울)
    id: 'krx',
    isOpen: now => {
      const { day, minutes } = zonedClock(now, 'Asia/Seoul');
      return isWeekday(day) && minutes >= hm(9) && minutes < hm(15, 30);
    },
  },
  {
    // SP500, NASDAQ, SOX, US10Y: 월~금 09:30 ~ 16:00 (뉴욕). US10Y는 측정상 미국 장 시간에만 갱신됨 (B-08, B-10)
    id: 'us_equity',
    isOpen: now => {
      const { day, minutes } = zonedClock(now, 'America/New_York');
      return isWeekday(day) && minutes >= hm(9, 30) && minutes < hm(16);
    },
  },
  {
    // USD/KRW, DXY, WTI, COPPER: 일 18:00 ~ 금 17:00 (뉴욕). 주말만 닫힌다고 단순화 (선물의 일일 휴장 1시간은 무시)
    id: 'global_24h',
    isOpen: now => {
      const { day, minutes } = zonedClock(now, 'America/New_York');
      if (day === 6) return false;
      if (day === 0) return minutes >= hm(18);
      if (day === 5) return minutes < hm(17);
      return true;
    },
  },
];
