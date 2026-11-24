import { useMemo } from 'react'
import { dashboard } from '../lib/dashboard'
import { useData } from './DataContext'

/** The director dashboard figures, recalculated only when the data changes. */
export function useDashboard() {
  const { staff, bills, payments, payroll_months, estimate_items, company_docs, tasks, leaves, projects } = useData()
  return useMemo(() => dashboard({ staff, bills, payments, payroll_months, estimate_items, company_docs, tasks, leaves, projects }),
    [staff, bills, payments, payroll_months, estimate_items, company_docs, tasks, leaves, projects])
}
