import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function signIn(e: FormEvent) {
    e.preventDefault()
    if (!password) return sendLink()
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) setMsg({ ok: false, text: 'That email and password don’t match. Try again, or get a sign-in link by email.' })
  }

  async function sendLink() {
    if (!email.trim()) { setMsg({ ok: false, text: 'Enter your work email first.' }); return }
    setBusy(true)
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false, emailRedirectTo: window.location.origin } })
    setBusy(false)
    setMsg(error
      ? { ok: false, text: error.message.includes('Signups not allowed') ? 'This email hasn’t been invited yet. Ask an admin to invite you.' : `Couldn’t send the link: ${error.message}` }
      : { ok: true, text: `Check ${email.trim()} for a sign-in link. It may take a minute.` })
  }

  return (
    <div className="login">
      <form className="panel" onSubmit={signIn}>
        <div className="brandrow"><img src="/logo.jpg" alt="" /><div className="brand"><b>MAAVEL</b><span>Office &amp; overheads</span></div></div>
        <h1>Sign in</h1>
        <label>Work email<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label>Password
          <span className="pw">
            <input type={show ? 'text' : 'password'} autoComplete="current-password" value={password} placeholder="Leave blank to get an email link" onChange={e => setPassword(e.target.value)} />
            <button type="button" className="link" aria-pressed={show} onClick={() => setShow(v => !v)}>{show ? 'Hide' : 'Show'}</button>
          </span>
        </label>
        {msg && <p className={msg.ok ? 'ok' : 'err'} role="status">{msg.text}</p>}
        <button className="primary" type="submit" disabled={busy}>{password ? 'Sign in' : 'Email me a sign-in link'}</button>
        {password && <button type="button" className="link" onClick={sendLink}>Forgot password? Email me a link</button>}
        <p className="note">Only people invited by a Maavel admin can sign in.</p>
      </form>
    </div>
  )
}
