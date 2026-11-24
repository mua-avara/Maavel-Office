// Maavel Office: lets an admin create, reset and remove logins from the Team tab.
// Deploy in Supabase: Edge Functions -> Deploy a new function -> Via editor,
// name it "admin-users", paste this file, keep "Verify JWT" on, Deploy.
// The secret key comes from the function's own environment; it never reaches the browser.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const ROLES = ['admin', 'editor', 'viewer']

function secretKey(): string {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (legacy) return legacy
  // Newer projects: a JSON object of secret keys, e.g. {"default":"sb_secret_..."}.
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}')
    return keys.default ?? Object.values(keys)[0] ?? ''
  } catch { return '' }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply({ error: 'Use POST.' }, 405)

  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const admin = createClient(url, secretKey(), { auth: { persistSession: false, autoRefreshToken: false } })

  // Who is calling, and are they an admin?
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: who, error: whoErr } = await admin.auth.getUser(token)
  if (whoErr || !who.user) return reply({ error: 'Please sign in again.' }, 401)
  const { data: me } = await admin.from('profiles').select('role').eq('id', who.user.id).maybeSingle()
  if (me?.role !== 'admin') return reply({ error: 'Only an admin can manage logins.' }, 403)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return reply({ error: 'Bad request.' }, 400) }
  const action = String(body.action ?? '')

  if (action === 'create') {
    const email = String(body.email ?? '').trim().toLowerCase()
    const password = String(body.password ?? '')
    const fullName = String(body.full_name ?? '').trim()
    const role = ROLES.includes(String(body.role)) ? String(body.role) : 'viewer'
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply({ error: 'Enter a valid email.' }, 400)
    if (password.length < 8) return reply({ error: 'The password needs at least 8 characters.' }, 400)
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } })
    if (error || !data.user) {
      const msg = error?.message ?? 'Could not create the login.'
      return reply({ error: /already|registered|exists/i.test(msg) ? 'Someone already has a login with that email.' : msg }, 400)
    }
    const { error: pErr } = await admin.from('profiles').upsert({ id: data.user.id, email, full_name: fullName || null, role }, { onConflict: 'id' })
    if (pErr) return reply({ error: `Login made, but the role was not saved: ${pErr.message}` }, 500)
    return reply({ ok: true, id: data.user.id })
  }

  if (action === 'set_password') {
    const id = String(body.id ?? '')
    const password = String(body.password ?? '')
    if (password.length < 8) return reply({ error: 'The password needs at least 8 characters.' }, 400)
    const { error } = await admin.auth.admin.updateUserById(id, { password })
    return error ? reply({ error: error.message }, 400) : reply({ ok: true })
  }

  if (action === 'remove') {
    const id = String(body.id ?? '')
    if (id === who.user.id) return reply({ error: 'You cannot remove your own login.' }, 400)
    const { data: target } = await admin.from('profiles').select('role').eq('id', id).maybeSingle()
    if (target?.role === 'admin') {
      const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin')
      if ((count ?? 0) <= 1) return reply({ error: 'Maavel needs at least one admin.' }, 400)
    }
    const { error } = await admin.auth.admin.deleteUser(id)
    return error ? reply({ error: error.message }, 400) : reply({ ok: true })
  }

  return reply({ error: 'Unknown action.' }, 400)
})
