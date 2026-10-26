// 실적·배당 캘린더 요청 값 검사와 날짜 계산 (docs/Task_ORDER.md T-111). 테스트할 수 있도록 DB와 분리한 순수 함수다.

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export const isCalendarMonth = (value: unknown): value is string => typeof value === 'string' && MONTH_PATTERN.test(value);

// 형식이 맞고 실제로 있는 날짜인지 (2월 30일 등 거부, 예외를 던지지 않음)
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

const pad = (value: number) => String(value).padStart(2, '0');

// "2026-12" → "2027-01-01"
export function nextMonthStart(month: string) {
  const year = Number(month.slice(0, 4));
  const mon = Number(month.slice(5, 7));
  return mon === 12 ? `${year + 1}-01-01` : `${year}-${pad(mon + 1)}-01`;
}

// "2026-10-31" → "2026-11-01"
export const nextDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
