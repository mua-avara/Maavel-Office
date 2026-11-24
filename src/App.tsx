import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { configured, supabase } from './lib/supabase'
import { DataProvider, useData } from './data/DataContext'
import { MONTHS, shiftMonth, thisMonth } from './lib/format'
import Login from './auth/Login'
import MonthView from './views/MonthView'
import StaffView from './views/StaffView'
import PayrollView from './views/PayrollView'
import EstimateView from './views/EstimateView'
import TeamView from './views/TeamView'
import DashboardView from './views/DashboardView'
import CompanyView from './views/CompanyView'
import ProjectsView from './views/ProjectsView'

const VIEWS = [['home', 'Dashboard'], ['month', 'Month'], ['staff', 'Staff'], ['payroll', 'Payroll'], ['estimate', 'Estimate'], ['projects', 'Projects'], ['company', 'Company'], ['team', 'Team']] as const
type View = typeof VIEWS[number][0]
/** "#staff/abc" → view "staff", item "abc". */
const parseHash = (): { v: View; id: string | null } => {
  const [v, ...rest] = location.hash.slice(1).split('/')
  const view = VIEWS.find(x => x[0] === v)?.[0] ?? 'home'
  return { v: view, id: rest.length ? decodeURIComponent(rest.join('/')) : null }
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true) })
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (!configured) return <div className="login"><div className="panel"><h1>Setup needed</h1><p>Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to the hosting settings (or <code>.env.local</code>), then rebuild. See README.md.</p></div></div>
  if (!ready) return null
  if (!session) return <Login />
  return <DataProvider userId={session.user.id}><Shell email={session.user.email ?? ''} /></DataProvider>
}

function Shell({ email }: { email: string }) {
  const d = useData()
  const [{ v: view, id: itemId }, setRoute] = useState(parseHash)
  const [k, setK] = useState(thisMonth)

  useEffect(() => {
    const on = () => {
      const r = parseHash()
      // The estimate is usually for next month.
      if (r.v === 'estimate') setK(cur => (cur <= thisMonth ? shiftMonth(thisMonth, 1) : cur))
      setRoute(cur => { if (cur.v !== r.v || cur.id !== r.id) window.scrollTo(0, 0); return r })
      // Keep the current tab visible in the sideways-scrolling tab bar on phones.
      requestAnimationFrame(() => document.querySelector('nav.tabs a[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'center' }))
    }
    window.addEventListener('hashchange', on)
    on()
    return () => window.removeEventListener('hashchange', on)
  }, [])

  const showMonth = view === 'month' || view === 'payroll' || view === 'estimate'

  return (
    <div className="wrap">
      <header className="top">
        <img src="/logo.jpg" alt="Maavel logo" />
        <div className="brand"><b>MAAVEL</b><span>Office &amp; overheads</span></div>
        <div className="grow" />
        {showMonth && (
          <div className="monthbar">
            <button className="icon" aria-label="Previous month" onClick={() => setK(shiftMonth(k, -1))}>‹</button>
            <h1>{MONTHS[+k.slice(5) - 1]} {k.slice(0, 4)}</h1>
            <button className="icon" aria-label="Next month" onClick={() => setK(shiftMonth(k, 1))}>›</button>
          </div>
        )}
      </header>

      <nav className="tabs" aria-label="Sections">
        {VIEWS.map(([id, label]) => <a key={id} href={`#${id}`} aria-current={view === id ? 'page' : undefined}>{label}</a>)}
      </nav>

      {d.error && <div className="banner">Couldn’t load data: {d.error}</div>}
      {d.loaded && !d.me && <div className="banner">Your account is signed in but has no access yet. Ask a Maavel admin to add you.</div>}
      {d.me && !d.canEdit && <div className="banner">You have view-only access. Ask an admin if you need to make changes.</div>}

      {!d.loaded ? <p className="note">Loading…</p> : (
        view === 'home' ? <DashboardView />
          : view === 'month' ? <MonthView k={k} />
          : view === 'staff' ? <StaffView id={itemId} />
          : view === 'payroll' ? <PayrollView k={k} />
          : view === 'estimate' ? <EstimateView k={k} />
          : view === 'projects' ? <ProjectsView id={itemId} />
          : view === 'company' ? <CompanyView />
          : <TeamView />
      )}

      <footer className="foot">
        <span>Signed in as {email}{d.me ? ` · ${d.me.role}` : ''}</span>
        <button className="link" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </footer>
      <div className={`toast${d.toastMsg ? ' show' : ''}`} role="status">{d.toastMsg}</div>
    </div>
  )
}
