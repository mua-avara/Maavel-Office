export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export const pad = (n: number) => String(n).padStart(2, '0')
export const num = (v: unknown) => Number(v) || 0
export const fmt = (n: unknown) => num(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const fmt0 = (n: unknown) => num(n).toLocaleString('en-US', { maximumFractionDigits: 0 })

const now = new Date()
export const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
export const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
export const thisMonth = todayStr.slice(0, 7)

export const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate()
export const monthEnd = (k: string) => `${k}-${pad(lastDay(+k.slice(0, 4), +k.slice(5)))}`
export const monthName = (k: string) => `${MONTHS[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}`
export function shiftMonth(k: string, d: number) {
  let y = +k.slice(0, 4), m = +k.slice(5) + d
  while (m < 1) { m += 12; y-- }
  while (m > 12) { m -= 12; y++ }
  return `${y}-${pad(m)}`
}
export function niceDate(s: string | null | undefined) {
  if (!s) return ''
  const [y, m, d] = s.split('-').map(Number)
  return `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}`
}
export const parseDate = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
export const daysFromToday = (s: string) => Math.round((parseDate(s).getTime() - today.getTime()) / 864e5)
export const ordinal = (n: number) => n + (['th', 'st', 'nd', 'rd'][(n % 10 > 3 || Math.floor((n % 100) / 10) === 1) ? 0 : n % 10])
