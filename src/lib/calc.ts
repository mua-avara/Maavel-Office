import { DOCS, type Bill, type EstimateItem, type Leave, type PayLine, type Payment, type PayrollMonth, type Staff } from './types'
import { daysFromToday, lastDay, monthEnd, num, pad, parseDate, shiftMonth, thisMonth, todayStr } from './format'

/* ---------- staff documents ---------- */
export type DocState = { key: 'paid' | 'soon' | 'overdue' | 'upcoming'; text: string; need: boolean; hasDates: boolean }

export function docState(s: Staff): DocState {
  let worst: { days: number; label: string } | null = null
  for (const [field, label] of DOCS) {
    const v = s[field] as string | null
    if (!v) continue
    const d = daysFromToday(v)
    if (!worst || d < worst.days) worst = { days: d, label }
  }
  if (!worst) return { key: 'upcoming', text: 'Add dates', need: false, hasDates: false }
  if (worst.days < 0) return { key: 'overdue', text: `${worst.label} expired`, need: true, hasDates: true }
  if (worst.days <= 30) return { key: 'overdue', text: `${worst.label} in ${worst.days}d`, need: true, hasDates: true }
  if (worst.days <= 60) return { key: 'soon', text: `${worst.label} in ${worst.days}d`, need: true, hasDates: true }
  return { key: 'paid', text: 'OK', need: false, hasDates: true }
}

export const isActive = (s: Staff) => s.status !== 'Left'
export const isLocal = (s: Staff) => s.country.trim().toLowerCase() === 'maldives'
export const byOrder = (a: Staff, b: Staff) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)

/** Staff who should be on the payroll for month k. */
export function staffForMonth(staff: Staff[], k: string) {
  const start = `${k}-01`, end = monthEnd(k)
  return staff.filter(s => {
    if (s.join_date && s.join_date > end) return false
    if (s.status === 'Left' && (!s.left_date || s.left_date < start)) return false
    return true
  }).sort(byOrder)
}

/* ---------- payroll ---------- */
export const linesFromStaff = (staff: Staff[], k: string): PayLine[] =>
  staffForMonth(staff, k).map(s => ({
    staffId: s.id, name: s.name, designation: s.designation, country: s.country,
    basic: num(s.basic), food: num(s.food), allowance: num(s.allowance), extra: 0, deduction: 0,
    projectId: s.project_id ?? null,
  }))

export const lineSalary = (l: PayLine) => num(l.basic) + num(l.extra) - num(l.deduction)
export const lineTotal = (l: PayLine) => lineSalary(l) + num(l.food) + num(l.allowance)

export function payTotals(lines: PayLine[]) {
  const sal = lines.reduce((a, l) => a + lineSalary(l), 0)
  const food = lines.reduce((a, l) => a + num(l.food), 0)
  const allow = lines.reduce((a, l) => a + num(l.allowance), 0)
  return { sal, food, allow, total: sal + food + allow, count: lines.length }
}

export type PayrollInfo = { source: 'lines' | 'totals' | 'none'; paid: boolean; paidDate: string | null; sal: number; food: number; allow: number; total: number; count: number | null }

export function payrollInfo(pm: PayrollMonth | undefined): PayrollInfo {
  if (pm?.lines?.length) {
    const t = payTotals(pm.lines)
    return { source: 'lines', paid: pm.pay_status === 'paid', paidDate: pm.paid_date, ...t }
  }
  if (pm && (pm.salaries || pm.food)) {
    const sal = num(pm.salaries), food = num(pm.food), allow = num(pm.allowances)
    return { source: 'totals', paid: true, paidDate: pm.paid_date, sal, food, allow, total: sal + food + allow, count: pm.staff_count }
  }
  return { source: 'none', paid: false, paidDate: null, sal: 0, food: 0, allow: 0, total: 0, count: 0 }
}

/* ---------- bills for a month ---------- */
export type BillStatus = { key: 'paid' | 'overdue' | 'soon' | 'upcoming'; label: string }

export function dueDateFor(b: Bill, k: string) {
  const d = Math.min(b.due_day || 1, lastDay(+k.slice(0, 4), +k.slice(5)))
  return `${k}-${pad(d)}`
}

export function billStatus(b: Bill, k: string, paid: Payment[]): BillStatus {
  if (paid.length) return { key: 'paid', label: 'Paid' }
  const diff = daysFromToday(dueDateFor(b, k))
  if (diff < 0) return { key: 'overdue', label: 'Overdue' }
  if (diff <= 5) return { key: 'soon', label: 'Due soon' }
  return { key: 'upcoming', label: 'Upcoming' }
}

const byDue = (a: Bill, b: Bill) => a.due_day - b.due_day || a.name.localeCompare(b.name)

export function monthSummary(k: string, bills: Bill[], payments: Payment[], pm: PayrollMonth | undefined, staff: Staff[]) {
  const mp = payments.filter(p => p.month === k)
  const rows = bills.filter(b => b.active).sort(byDue).map(b => {
    const paid = mp.filter(p => p.bill_id === b.id)
    return { bill: b, paid, status: billStatus(b, k, paid), due: dueDateFor(b, k) }
  })
  const other = mp.filter(p => !p.bill_id).sort((a, b) => a.date.localeCompare(b.date))
  const paidTotal = mp.reduce((a, p) => a + num(p.amount), 0)
  const unpaid = rows.filter(r => r.status.key !== 'paid')
  const pr = payrollInfo(pm)
  let payDue = 0
  if (!pr.paid && k >= thisMonth) payDue = pr.source === 'lines' ? pr.total : payTotals(linesFromStaff(staff, k)).total
  const dueTotal = unpaid.reduce((a, r) => a + num(r.bill.amount), 0) + payDue
  const salPaid = pr.paid ? pr.total : 0
  return { k, mp, rows, other, paidTotal, unpaid, payDue, dueTotal, pr, salPaid, total: paidTotal + salPaid }
}

/* ---------- overhead estimate ---------- */
export function estimate(k: string, staff: Staff[], bills: Bill[], payments: Payment[], items: EstimateItem[], opts: { useOther: boolean; contingency: number }) {
  const st = staffForMonth(staff, k).filter(s => s.status !== 'Left')
    .map(s => ({ name: s.name, designation: s.designation, basic: num(s.basic), food: num(s.food), allow: num(s.allowance) }))
  const staffBasic = st.reduce((a, s) => a + s.basic, 0)
  const staffFood = st.reduce((a, s) => a + s.food, 0)
  const staffAllow = st.reduce((a, s) => a + s.allow, 0)
  const prev = [shiftMonth(k, -1), shiftMonth(k, -2), shiftMonth(k, -3)]
  const billRows = bills.filter(b => b.active).sort(byDue).map(b => {
    if (b.amount != null) return { name: b.name, category: b.category, due: b.due_day, amount: num(b.amount), basis: 'Usual amount' }
    const paid = prev.map(pk => payments.filter(p => p.month === pk && p.bill_id === b.id).reduce((a, p) => a + num(p.amount), 0)).filter(v => v > 0)
    if (paid.length) return { name: b.name, category: b.category, due: b.due_day, amount: paid.reduce((a, v) => a + v, 0) / paid.length, basis: `Average of last ${paid.length} month${paid.length > 1 ? 's' : ''}` }
    return { name: b.name, category: b.category, due: b.due_day, amount: 0, basis: 'No amount yet' }
  })
  const billsTotal = billRows.reduce((a, r) => a + r.amount, 0)
  const otherByMonth = prev.map(pk => payments.filter(p => p.month === pk && !p.bill_id).reduce((a, p) => a + num(p.amount), 0))
  const otherAvg = otherByMonth.reduce((a, v) => a + v, 0) / 3
  const extras = items.filter(i => i.month === k)
  const extrasTotal = extras.reduce((a, x) => a + num(x.amount), 0)
  const sub = staffBasic + staffFood + staffAllow + billsTotal + extrasTotal + (opts.useOther ? otherAvg : 0)
  const contAmt = sub * Math.max(0, opts.contingency) / 100
  const end = monthEnd(k)
  const renew: { name: string; doc: string; date: string }[] = []
  staff.filter(isActive).forEach(s => DOCS.forEach(([f, label]) => {
    const v = s[f] as string | null
    if (v && v <= end) renew.push({ name: s.name, doc: label, date: v })
  }))
  renew.sort((a, b) => a.date.localeCompare(b.date))
  return { k, st, staffBasic, staffFood, staffAllow, billRows, billsTotal, otherAvg, extras, extrasTotal, useOther: opts.useOther, cont: opts.contingency, contAmt, total: sub + contAmt, renew }
}
export type Estimate = ReturnType<typeof estimate>
export type MonthSummary = ReturnType<typeof monthSummary>

/* ---------- leave ---------- */
/** Maldives Employment Act: 30 days annual leave, 15 days sick leave a year. */
export const SICK_DAYS = 15

/** Calendar days from start to end, both included. */
export function leaveDays(start: string, end: string) {
  if (!start || !end || end < start) return 0
  return Math.round((parseDate(end).getTime() - parseDate(start).getTime()) / 864e5) + 1
}

export function leaveSummary(s: Staff, leaves: Leave[], year: string) {
  const mine = leaves.filter(l => l.staff_id === s.id && l.start_date.startsWith(year))
  const used = (t: string) => mine.filter(l => l.type === t).reduce((a, l) => a + num(l.days), 0)
  const entitled = s.annual_leave_days ?? 30
  const annual = used('Annual')
  return { entitled, annual, annualLeft: entitled - annual, sick: used('Sick'), sickLeft: SICK_DAYS - used('Sick'), other: mine.filter(l => l.type !== 'Annual' && l.type !== 'Sick').reduce((a, l) => a + num(l.days), 0) }
}

/** Leave records that cover a given day (default today). */
export const onLeaveOn = (leaves: Leave[], day = todayStr) => leaves.filter(l => l.start_date <= day && l.end_date >= day)
