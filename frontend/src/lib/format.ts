// 숫자·시각 표시 (docs/Task_ORDER.md T-41)

// 지표마다 정한 자릿수로 표시한다. 자릿수를 고정해서 값이 바뀔 때 글자 폭이 흔들리지 않게 한다.
export function formatNumber(value: number, decimals: number) {
  return value.toLocaleString('ko-KR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

// 축 눈금은 공간이 좁아서 끝자리 0을 생략한다.
export function formatAxisNumber(value: number, decimals: number) {
  return value.toLocaleString('ko-KR', { maximumFractionDigits: decimals })
}

const pad = (value: number) => value.toString().padStart(2, '0')

export function formatClock(ms: number, withSeconds = true) {
  const date = new Date(ms)
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  return withSeconds ? `${time}:${pad(date.getSeconds())}` : time
}

export function formatDate(ms: number, withYear = false) {
  const date = new Date(ms)
  const monthDay = `${date.getMonth() + 1}/${date.getDate()}`
  return withYear ? `${date.getFullYear()}/${monthDay}` : monthDay
}
