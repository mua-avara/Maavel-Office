import { lineTotal } from './calc'
import { num } from './format'
import type { Payment, PayrollMonth, Project } from './types'

export type ProjectCost = {
  expenses: number
  staff: number
  total: number
  /** Spend by month, oldest first: [YYYY-MM, expenses, staff]. */
  months: [string, number, number][]
  byCategory: [string, number][]
  payments: Payment[]
  /** Against budget (or contract value if no budget); null when neither is set. */
  limit: number | null
  pct: number | null
}

/**
 * What a project has cost: expenses tagged to it, plus salaries of people who were
 * on that site when a paid salary sheet was built (PayLine.projectId).
 */
export function projectCost(p: Project, payments: Payment[], payroll: PayrollMonth[]): ProjectCost {
  const mine = payments.filter(x => x.project_id === p.id).sort((a, b) => b.date.localeCompare(a.date))
  const months = new Map<string, [number, number]>()
  const add = (k: string, e: number, s: number) => { const m = months.get(k) ?? [0, 0]; months.set(k, [m[0] + e, m[1] + s]) }
  const cats: Record<string, number> = {}
  for (const x of mine) { add(x.month, num(x.amount), 0); cats[x.category || 'Other'] = (cats[x.category || 'Other'] || 0) + num(x.amount) }
  let staff = 0
  for (const m of payroll) {
    if (m.pay_status !== 'paid' || !m.lines) continue
    const s = m.lines.filter(l => l.projectId === p.id).reduce((a, l) => a + lineTotal(l), 0)
    if (s) { staff += s; add(m.month, 0, s) }
  }
  const expenses = mine.reduce((a, x) => a + num(x.amount), 0)
  const total = expenses + staff
  const limit = num(p.budget) || num(p.contract_value) || null
  return {
    expenses, staff, total, payments: mine, limit,
    pct: limit ? Math.round((total / limit) * 100) : null,
    months: [...months.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, [e, s]]) => [k, e, s]),
    byCategory: Object.entries(cats).sort((a, b) => b[1] - a[1]),
  }
}

export const projectSpendIn = (c: ProjectCost, k: string) => c.months.filter(m => m[0] === k).reduce((a, m) => a + m[1] + m[2], 0)
