import { useState } from 'react'
import { useData } from '../data/DataContext'
import { supabase } from '../lib/supabase'
import { createLogin, makePassword, removeLogin, setLoginPassword } from '../lib/admin'
import type { Profile, Role } from '../lib/types'
import { ConfirmDelete, Field, Modal, Section } from '../components/ui'

const ROLE_HELP: Record<Role, string> = {
  admin: 'Can change everything, including who has access',
  editor: 'Can record payments, run payroll and edit staff',
  viewer: 'Can see figures and download PDFs only',
}

type NewLogin = { full_name: string; email: string; role: Role; password: string }
type Made = { email: string; password: string; name: string }

export default function TeamView() {
  const d = useData()
  const [pw, setPw] = useState('')
  const [add, setAdd] = useState<NewLogin | null>(null)
  const [reset, setReset] = useState<{ p: Profile; password: string } | null>(null)
  const [made, setMade] = useState<Made | null>(null)

  async function setPassword() {
    if (pw.length < 8) { d.toast('Use at least 8 characters.'); return }
    const { error } = await supabase.auth.updateUser({ password: pw })
    d.toast(error ? `Not saved: ${error.message}` : 'Password set. You can now sign in with it.')
    if (!error) setPw('')
  }

  async function saveNew() {
    if (!add) return
    const r = await createLogin({ ...add, email: add.email.trim(), full_name: add.full_name.trim() })
    if (!r.ok) { d.toast(r.error); return }
    setMade({ email: add.email.trim(), password: add.password, name: add.full_name.trim() })
    setAdd(null)
    d.reload('profiles')
  }

  async function saveReset() {
    if (!reset) return
    const r = await setLoginPassword(reset.p.id, reset.password)
    if (!r.ok) { d.toast(r.error); return }
    setMade({ email: reset.p.email, password: reset.password, name: reset.p.full_name || '' })
    setReset(null)
  }

  async function remove(p: Profile) {
    const r = await removeLogin(p.id)
    if (!r.ok) { d.toast(r.error); return }
    setReset(null)
    d.toast(`${p.email} can no longer sign in.`)
    d.reload('profiles')
  }

  const loginText = made && `Maavel Office login\n${location.origin}\nEmail: ${made.email}\nPassword: ${made.password}\nPlease change the password on the Team tab after you sign in.`

  return (
    <div className="view">
      <Section title="Team access" intro={d.isAdmin
        ? 'Add a login for each partner or staff member who needs the app. New people can change their password after they sign in.'
        : 'Only an admin can change who has access.'}
        action={d.isAdmin ? <button className="primary" onClick={() => setAdd({ full_name: '', email: '', role: 'viewer', password: makePassword() })}>Add person</button> : undefined}>
        {made && loginText && (
          <div className="notice">
            <p><b>Login ready{made.name ? ` for ${made.name}` : ''}.</b> Send these details to them privately. The password isn’t shown again.</p>
            <pre>{loginText}</pre>
            <div className="row">
              <button className="primary" onClick={() => navigator.clipboard.writeText(loginText).then(() => d.toast('Copied'), () => d.toast('Copy didn’t work. Select the text instead.'))}>Copy login details</button>
              <button onClick={() => setMade(null)}>Done</button>
            </div>
          </div>
        )}
        <div className="tablewrap"><table>
          <thead><tr><th>Person</th><th>Access</th></tr></thead>
          <tbody>
            {[...d.profiles].sort((a, b) => a.email.localeCompare(b.email)).map(p => (
              <tr key={p.id}>
                <td>{p.full_name || p.email}<span className="sub">{p.email}{p.id === d.me?.id ? ' · you' : ''}</span>
                  {d.isAdmin && p.id !== d.me?.id && <button className="link small-link" onClick={() => setReset({ p, password: makePassword() })}>Password or remove…</button>}
                </td>
                <td>
                  {d.isAdmin && p.id !== d.me?.id ? (
                    <select aria-label={`Access for ${p.email}`} value={p.role} onChange={e => d.upsert('profiles', { id: p.id, email: p.email, role: e.target.value as Role })}>
                      <option value="admin">Admin</option><option value="editor">Editor</option><option value="viewer">Viewer</option>
                    </select>
                  ) : <span className="cap">{p.role}</span>}
                  <span className="sub">{ROLE_HELP[p.role]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Section>

      <Section title="Your password" intro="Set a password so you can sign in without waiting for an email link.">
        <form className="row" onSubmit={e => { e.preventDefault(); setPassword() }}>
          <Field label="New password"><input type="password" autoComplete="new-password" minLength={8} value={pw} onChange={e => setPw(e.target.value)} /></Field>
          <button className="primary" type="submit">Save password</button>
        </form>
      </Section>

      <Modal open={!!add} title="Add person" onClose={() => setAdd(null)} onSubmit={saveNew}>
        {add && <>
          <Field label="Name"><input required value={add.full_name} placeholder="e.g. Aishath Hassan" onChange={e => setAdd({ ...add, full_name: e.target.value })} /></Field>
          <Field label="Email (their login)"><input required type="email" autoComplete="off" value={add.email} onChange={e => setAdd({ ...add, email: e.target.value })} /></Field>
          <Field label="Access"><select value={add.role} onChange={e => setAdd({ ...add, role: e.target.value as Role })}>
            <option value="viewer">Viewer: see and download only</option>
            <option value="editor">Editor: can add and change data</option>
            <option value="admin">Admin: everything, including logins</option>
          </select></Field>
          <Field label="Temporary password">
            <div className="inline"><input required minLength={8} value={add.password} onChange={e => setAdd({ ...add, password: e.target.value })} />
              <button type="button" onClick={() => setAdd({ ...add, password: makePassword() })}>New</button></div>
          </Field>
          <p className="note">They can sign in straight away. You’ll get the details to send them.</p>
        </>}
      </Modal>

      <Modal open={!!reset} title={reset ? (reset.p.full_name || reset.p.email) : ''} onClose={() => setReset(null)} onSubmit={saveReset}
        footer={reset ? <ConfirmDelete label="Remove access" onConfirm={() => remove(reset.p)} /> : undefined}>
        {reset && <>
          <p className="note">Set a new password for {reset.p.email}, or remove their access completely. Removing it doesn’t delete any company data.</p>
          <Field label="New password">
            <div className="inline"><input required minLength={8} value={reset.password} onChange={e => setReset({ ...reset, password: e.target.value })} />
              <button type="button" onClick={() => setReset({ ...reset, password: makePassword() })}>New</button></div>
          </Field>
        </>}
      </Modal>
    </div>
  )
}
