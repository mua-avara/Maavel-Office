import { useState } from 'react'
import { useData } from '../data/DataContext'
import { supabase } from '../lib/supabase'
import type { Role } from '../lib/types'
import { Field, Section } from '../components/ui'

const ROLE_HELP: Record<Role, string> = {
  admin: 'Can change everything, including who has access',
  editor: 'Can record payments, run payroll and edit staff',
  viewer: 'Can see figures and download PDFs only',
}

export default function TeamView() {
  const d = useData()
  const [pw, setPw] = useState('')

  async function setPassword() {
    if (pw.length < 8) { d.toast('Use at least 8 characters.'); return }
    const { error } = await supabase.auth.updateUser({ password: pw })
    d.toast(error ? `Not saved: ${error.message}` : 'Password set. You can now sign in with it.')
    if (!error) setPw('')
  }

  return (
    <div className="view">
      <Section title="Team access" intro={d.isAdmin
        ? 'People appear here after you invite them from Supabase (Authentication → Users → Invite) and they sign in once. New people start as viewers.'
        : 'Only an admin can change who has access.'}>
        <div className="tablewrap"><table>
          <thead><tr><th>Person</th><th>Access</th></tr></thead>
          <tbody>
            {[...d.profiles].sort((a, b) => a.email.localeCompare(b.email)).map(p => (
              <tr key={p.id}>
                <td>{p.full_name || p.email}<span className="sub">{p.email}{p.id === d.me?.id ? ' · you' : ''}</span></td>
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
    </div>
  )
}
