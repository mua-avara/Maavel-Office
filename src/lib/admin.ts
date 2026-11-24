import { supabase } from './supabase'
import type { Role } from './types'

type Result = { ok: true; id?: string } | { ok: false; error: string }

/** Calls the "admin-users" Edge Function (supabase/functions/admin-users). */
async function call(body: Record<string, unknown>): Promise<Result> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body })
  if (!error) return { ok: true, id: data?.id }
  // Pull the readable message out of the function's reply when there is one.
  const ctx = (error as { context?: Response }).context
  if (ctx && typeof ctx.json === 'function') {
    try {
      const j = await ctx.json()
      if (j?.error) return { ok: false, error: j.error }
    } catch { /* not JSON */ }
    if (ctx.status === 404) return { ok: false, error: 'The "admin-users" function is not set up in Supabase yet. See README → Logins.' }
  }
  if (/Failed to send|fetch/i.test(error.message)) return { ok: false, error: 'Couldn’t reach the "admin-users" function. Is it deployed in Supabase?' }
  return { ok: false, error: error.message }
}

export const createLogin = (p: { email: string; password: string; full_name: string; role: Role }) => call({ action: 'create', ...p })
export const setLoginPassword = (id: string, password: string) => call({ action: 'set_password', id, password })
export const removeLogin = (id: string) => call({ action: 'remove', id })

/** A readable temporary password, e.g. "Reef-Tide-4827". */
export function makePassword() {
  const words = ['Reef', 'Tide', 'Coral', 'Lagoon', 'Atoll', 'Palm', 'Wave', 'Sand', 'Dhoni', 'Island', 'Harbor', 'Breeze']
  const r = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n
  return `${words[r(words.length)]}-${words[r(words.length)]}-${1000 + r(9000)}`
}
