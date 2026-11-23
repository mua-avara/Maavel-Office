import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { Bill, CompanyDoc, EstimateItem, Payment, PayrollMonth, Profile, Staff, Task } from '../lib/types'

type Tables = {
  staff: Staff[]
  bills: Bill[]
  payments: Payment[]
  payroll_months: PayrollMonth[]
  estimate_items: EstimateItem[]
  profiles: Profile[]
  company_docs: CompanyDoc[]
  tasks: Task[]
}
type TableName = keyof Tables
const TABLES: TableName[] = ['staff', 'bills', 'payments', 'payroll_months', 'estimate_items', 'profiles', 'company_docs', 'tasks']
/** Tables added after the first release. If they are missing (SQL not run yet) the app still works without them. */
const OPTIONAL: TableName[] = ['company_docs', 'tasks']
const KEY: Record<TableName, string> = { staff: 'id', bills: 'id', payments: 'id', payroll_months: 'month', estimate_items: 'id', profiles: 'id', company_docs: 'id', tasks: 'id' }

type Ctx = Tables & {
  loaded: boolean
  error: string | null
  /** New tables that are not in the database yet (schema.sql section not run). */
  missing: TableName[]
  me: Profile | null
  canEdit: boolean
  isAdmin: boolean
  upsert: <T extends TableName>(table: T, row: Partial<Tables[T][number]>) => Promise<boolean>
  remove: (table: TableName, id: string) => Promise<boolean>
  toast: (msg: string) => void
  toastMsg: string
}

const DataContext = createContext<Ctx | null>(null)

const empty: Tables = { staff: [], bills: [], payments: [], payroll_months: [], estimate_items: [], profiles: [], company_docs: [], tasks: [] }

export function DataProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [data, setData] = useState<Tables>(empty)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toastMsg, setToastMsg] = useState('')
  const [missing, setMissing] = useState<TableName[]>([])

  const toast = useCallback((msg: string) => {
    setToastMsg(msg)
    window.setTimeout(() => setToastMsg(m => (m === msg ? '' : m)), 2800)
  }, [])

  const load = useCallback(async (t: TableName) => {
    const { data: rows, error: err } = await supabase.from(t).select('*').limit(5000)
    if (err) {
      if (OPTIONAL.includes(t)) { setMissing(m => (m.includes(t) ? m : [...m, t])); return }
      setError(err.message); return
    }
    setMissing(m => m.filter(x => x !== t))
    setData(d => ({ ...d, [t]: rows ?? [] }))
  }, [])

  useEffect(() => {
    let alive = true
    Promise.all(TABLES.map(load)).then(() => { if (alive) setLoaded(true) })
    // Live updates: whenever anyone changes a table, reload that table.
    const channel = supabase.channel('maavel-office')
    TABLES.forEach(t => channel.on('postgres_changes', { event: '*', schema: 'public', table: t }, () => { load(t) }))
    channel.subscribe()
    return () => { alive = false; supabase.removeChannel(channel) }
  }, [load])

  const me = useMemo(() => data.profiles.find(p => p.id === userId) ?? null, [data.profiles, userId])
  const canEdit = me?.role === 'admin' || me?.role === 'editor'
  const isAdmin = me?.role === 'admin'

  const upsert = useCallback(async <T extends TableName>(table: T, row: Partial<Tables[T][number]>) => {
    const { error: err } = await supabase.from(table).upsert(row as never, { onConflict: KEY[table] })
    if (err) { toast(err.code === '42501' ? 'You have view-only access. Ask an admin to make you an editor.' : `Not saved: ${err.message}`); return false }
    await load(table)
    return true
  }, [load, toast])

  const remove = useCallback(async (table: TableName, id: string) => {
    const { error: err } = await supabase.from(table).delete().eq(KEY[table], id)
    if (err) { toast(`Not deleted: ${err.message}`); return false }
    await load(table)
    return true
  }, [load, toast])

  const value: Ctx = { ...data, loaded, error, missing, me, canEdit, isAdmin, upsert, remove, toast, toastMsg }
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useData() {
  const c = useContext(DataContext)
  if (!c) throw new Error('useData must be used inside DataProvider')
  return c
}
