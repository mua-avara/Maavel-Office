import { DOCS, type Bill, type CompanyDoc, type EstimateItem, type Payment, type PayrollMonth, type Staff, type Task } from './types'
import { daysFromToday, monthName, num, shiftMonth, thisMonth, todayStr } from './format'
import { estimate, isActive, isLocal, monthSummary, payrollInfo } from './calc'

/** How urgent something is: bad = act now, warn = soon, ok = fine. */
export type Level = 'bad' | 'warn' | 'ok'

/** Expiry status shared by staff and company documents. */
export function expiryLevel(date: string | null): { level: Level | 'none'; days: number | null; text: string } {
  if (!date) return { level: 'none', days: null, text: 'No date' }
  const days = daysFromToday(date)
  if (days < 0) return { level: 'bad', days, text: `Expired ${-days}d ago` }
  if (days === 0) return { level: 'bad', days, text: 'Expires today' }
  if (days <= 30) return { level: 'bad', days, text: `In ${days}d` }
  if (days <= 60) return { level: 'warn', days, text: `In ${days}d` }
  return { level: 'ok', days, text: `In ${days}d` }
}

export const LEVEL_PILL: Record<Level | 'none', string> = { bad: 'overdue', warn: 'soon', ok: 'paid', none: 'upcoming' }

export type Alert = { level: Level; title: string; detail: string; href: string; date?: string }
export type Upcoming = { date: string; kind: 'Bill' | 'Staff document' | 'Company document' | 'To-do'; title: string; detail: string; href: string; amount?: number }

type Input = {
  staff: Staff[]; bills: Bill[]; payments: Payment[]; payroll_months: PayrollMonth[]
  estimate_items: EstimateItem[]; company_docs: CompanyDoc[]; tasks: Task[]
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function dashboard(d: Input) {
  const k = thisMonth
  const prevK = shiftMonth(k, -1)
  const nextK = shiftMonth(k, 1)
  const pm = (m: string) => d.payroll_months.find(p => p.month === m)

  /* ---- money ---- */
  const cur = monthSummary(k, d.bills, d.payments, pm(k), d.staff)
  const prev = monthSummary(prevK, d.bills, d.payments, pm(prevK), d.staff)
  const next = estimate(nextK, d.staff, d.bills, d.payments, d.estimate_items, { useOther: true, contingency: 0 })

  // Last 12 months of actual spend (what was paid), oldest first.
  const trend = Array.from({ length: 12 }, (_, i) => shiftMonth(k, i - 11)).map(m => {
    const mp = d.payments.filter(p => p.month === m)
    const pr = payrollInfo(pm(m))
    const staff = pr.paid ? pr.total : 0
    const bills = mp.filter(p => p.bill_id).reduce((a, p) => a + num(p.amount), 0)
    const other = mp.filter(p => !p.bill_id).reduce((a, p) => a + num(p.amount), 0)
    return { k: m, staff, bills, other, total: staff + bills + other }
  })
  const fullMonths = trend.slice(0, -1).filter(t => t.total > 0)
  const avg3 = (() => { const l = fullMonths.slice(-3); return l.length ? l.reduce((a, t) => a + t.total, 0) / l.length : 0 })()

  // Year to date by category.
  const year = k.slice(0, 4)
  const ytdCat: Record<string, number> = {}
  let ytdStaff = 0
  for (let m = `${year}-01`; m <= k; m = shiftMonth(m, 1)) {
    const pr = payrollInfo(pm(m))
    if (pr.paid) ytdStaff += pr.total
  }
  d.payments.filter(p => p.month.startsWith(year) && p.month <= k).forEach(p => {
    const c = p.category || 'Other'
    ytdCat[c] = (ytdCat[c] || 0) + num(p.amount)
  })
  const ytdRows = [['Salaries & allowances', ytdStaff] as [string, number], ...Object.entries(ytdCat)]
    .filter(r => r[1] > 0).sort((a, b) => b[1] - a[1])
  const ytdTotal = ytdRows.reduce((a, r) => a + r[1], 0)

  /* ---- people ---- */
  const active = d.staff.filter(isActive)
  const expats = active.filter(s => !isLocal(s))
  const byCountry = Object.entries(active.reduce<Record<string, number>>((a, s) => { const c = s.country.trim() || 'Not set'; a[c] = (a[c] || 0) + 1; return a }, {}))
    .sort((a, b) => b[1] - a[1])
  const byRole = Object.entries(active.reduce<Record<string, number>>((a, s) => { const c = s.designation.trim() || 'Not set'; a[c] = (a[c] || 0) + 1; return a }, {}))
    .sort((a, b) => b[1] - a[1])
  const onLeave = active.filter(s => s.status === 'On leave')
  const since90 = shiftMonth(k, -3) + '-01'
  const joined = active.filter(s => s.join_date && s.join_date >= since90).sort((a, b) => (b.join_date ?? '').localeCompare(a.join_date ?? ''))
  const left = d.staff.filter(s => !isActive(s) && s.left_date && s.left_date >= since90).sort((a, b) => (b.left_date ?? '').localeCompare(a.left_date ?? ''))
  const staffMonthly = active.reduce((a, s) => a + num(s.basic) + num(s.food) + num(s.allowance), 0)
  const staffBasic = active.reduce((a, s) => a + num(s.basic), 0)

  // Every staff document that is expired or expires within 90 days.
  const staffDocs = active.flatMap(s => DOCS.map(([f, label]) => {
    const date = s[f] as string | null
    return { staff: s, doc: label, date, ...expiryLevel(date) }
  })).filter(x => x.date && (x.days ?? 999) <= 90)
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
  // Expats missing a passport, work permit or visa date.
  const missingDates = expats.filter(s => !s.passport_exp || !s.wp_exp || !s.visa_exp)

  /* ---- company documents ---- */
  const companyDocs = [...d.company_docs].map(c => ({ doc: c, ...expiryLevel(c.expiry_date) }))
    .sort((a, b) => (a.doc.expiry_date ?? '9999').localeCompare(b.doc.expiry_date ?? '9999') || a.doc.name.localeCompare(b.doc.name))
  const companyDue = companyDocs.filter(c => c.days != null && c.days <= 90)
  const renewalCost90 = companyDue.reduce((a, c) => a + num(c.doc.renewal_cost), 0)

  /* ---- to-dos ---- */
  const open = d.tasks.filter(t => !t.done).sort(taskOrder)
  const overdueTasks = open.filter(t => t.due_date && t.due_date < todayStr)

  /* ---- needs attention ---- */
  const alerts: Alert[] = []
  const prevUnpaid = prev.unpaid
  if (prevUnpaid.length) alerts.push({ level: 'bad', title: `${plural(prevUnpaid.length, 'bill')} from ${monthName(prevK)} not marked paid`, detail: prevUnpaid.map(r => r.bill.name).join(', '), href: '#month' })
  const od = cur.unpaid.filter(r => r.status.key === 'overdue')
  if (od.length) alerts.push({ level: 'bad', title: `${plural(od.length, 'bill')} overdue`, detail: od.map(r => r.bill.name).join(', '), href: '#month' })
  const soon = cur.unpaid.filter(r => r.status.key === 'soon')
  if (soon.length) alerts.push({ level: 'warn', title: `${plural(soon.length, 'bill')} due in the next 5 days`, detail: soon.map(r => r.bill.name).join(', '), href: '#month' })
  const prevPay = payrollInfo(pm(prevK))
  if (!prevPay.paid) alerts.push({ level: 'bad', title: `${monthName(prevK)} payroll not marked paid`, detail: prevPay.source === 'lines' ? 'The salary sheet is built but still a draft.' : 'No salary sheet recorded yet.', href: '#payroll' })
  const expired = staffDocs.filter(x => (x.days ?? 0) < 0)
  if (expired.length) alerts.push({ level: 'bad', title: `${plural(expired.length, 'staff document')} expired`, detail: expired.map(x => `${x.staff.name} (${x.doc})`).join(', '), href: '#staff' })
  const due30 = staffDocs.filter(x => (x.days ?? -1) >= 0 && (x.days ?? 99) <= 30)
  if (due30.length) alerts.push({ level: 'bad', title: `${plural(due30.length, 'staff document')} expiring within 30 days`, detail: due30.map(x => `${x.staff.name} (${x.doc})`).join(', '), href: '#staff' })
  const due60 = staffDocs.filter(x => x.level === 'warn')
  if (due60.length) alerts.push({ level: 'warn', title: `${plural(due60.length, 'staff document')} expiring in 31–60 days`, detail: due60.map(x => `${x.staff.name} (${x.doc})`).join(', '), href: '#staff' })
  const cBad = companyDocs.filter(c => c.level === 'bad'), cWarn = companyDocs.filter(c => c.level === 'warn')
  if (cBad.length) alerts.push({ level: 'bad', title: `${plural(cBad.length, 'company licence or document', 'company licences or documents')}: expired or due within 30 days`, detail: cBad.map(c => c.doc.name).join(', '), href: '#company' })
  if (cWarn.length) alerts.push({ level: 'warn', title: `${plural(cWarn.length, 'company licence or document', 'company licences or documents')}: due in 31–60 days`, detail: cWarn.map(c => c.doc.name).join(', '), href: '#company' })
  if (overdueTasks.length) alerts.push({ level: 'bad', title: `${plural(overdueTasks.length, 'to-do')} overdue`, detail: overdueTasks.map(t => t.title).join(', '), href: '#home' })
  if (missingDates.length) alerts.push({ level: 'warn', title: `${plural(missingDates.length, 'expat')} without passport, work permit or visa dates`, detail: 'Add the dates so renewals are not missed: ' + missingDates.map(s => s.name).join(', '), href: '#staff' })
  alerts.sort((a, b) => (a.level === b.level ? 0 : a.level === 'bad' ? -1 : 1))

  /* ---- next 30 days ---- */
  const until = shiftMonth(k, 2) + '-01'
  const in30 = (date: string) => date >= todayStr && daysFromToday(date) <= 30
  const upcoming: Upcoming[] = []
  ;[cur, monthSummary(nextK, d.bills, d.payments, pm(nextK), d.staff)].forEach(m => m.unpaid.forEach(r => {
    if (r.due < until && in30(r.due)) upcoming.push({ date: r.due, kind: 'Bill', title: r.bill.name, detail: r.bill.category, href: '#month', amount: r.bill.amount ?? undefined })
  }))
  staffDocs.filter(x => x.date && in30(x.date)).forEach(x => upcoming.push({ date: x.date!, kind: 'Staff document', title: `${x.staff.name}: ${x.doc}`, detail: x.staff.designation, href: '#staff' }))
  companyDocs.filter(c => c.doc.expiry_date && in30(c.doc.expiry_date)).forEach(c => upcoming.push({ date: c.doc.expiry_date!, kind: 'Company document', title: c.doc.name, detail: c.doc.issuer || c.doc.category, href: '#company', amount: c.doc.renewal_cost ?? undefined }))
  open.filter(t => t.due_date && in30(t.due_date)).forEach(t => upcoming.push({ date: t.due_date!, kind: 'To-do', title: t.title, detail: t.owner ? `For ${t.owner}` : `${t.priority} priority`, href: '#home' }))
  upcoming.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind))

  return {
    k, prevK, nextK, cur, prev, next, trend, avg3, ytdRows, ytdTotal, year,
    active, expats, byCountry, byRole, onLeave, joined, left, staffMonthly, staffBasic, staffDocs, missingDates,
    companyDocs, companyDue, renewalCost90, open, overdueTasks, alerts, upcoming,
  }
}
export type Dashboard = ReturnType<typeof dashboard>

const PRI: Record<string, number> = { High: 0, Normal: 1, Low: 2 }
export function taskOrder(a: Task, b: Task) {
  return (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || (PRI[a.priority] ?? 1) - (PRI[b.priority] ?? 1) || a.title.localeCompare(b.title)
}
