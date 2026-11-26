import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { configured, supabase } from './lib/supabase'
import { DataProvider, useData } from './data/DataContext'
import { shiftMonth, thisMonth } from './lib/format'
import Shell, { type View } from './components/Shell'
import Login from './auth/Login'
import MonthView from './views/MonthView'
import StaffView from './views/StaffView'
import PayrollView from './views/PayrollView'
import EstimateView from './views/EstimateView'
import TeamView from './views/TeamView'
import DashboardView from './views/DashboardView'
import CompanyView from './views/CompanyView'
import ProjectsView from './views/ProjectsView'
import AssetsView from './views/AssetsView'

const VIEWS: View[] = ['home', 'month', 'staff', 'payroll', 'estimate', 'projects', 'assets', 'company', 'team']

/** "#staff/abc" → view "staff", item "abc". */
const parseHash = (): { v: View; id: string | null } => {
  const [v, ...rest] = location.hash.slice(1).split('/')
  const view = VIEWS.find(x => x === v) ?? 'home'
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
  return <DataProvider userId={session.user.id}><Main email={session.user.email ?? ''} /></DataProvider>
}

function Main({ email }: { email: string }) {
  const d = useData()
  const [{ v: view, id: itemId }, setRoute] = useState(parseHash)
  const [k, setK] = useState(thisMonth)

  useEffect(() => {
    const on = () => {
      const r = parseHash()
      // The estimate is usually for next month.
      if (r.v === 'estimate') setK(cur => (cur <= thisMonth ? shiftMonth(thisMonth, 1) : cur))
      setRoute(cur => { if (cur.v !== r.v || cur.id !== r.id) window.scrollTo(0, 0); return r })
    }
    window.addEventListener('hashchange', on)
    on()
    return () => window.removeEventListener('hashchange', on)
  }, [])

  return (
    <Shell view={view} pageKey={`${view}/${itemId && itemId !== 'new' && itemId !== 'expense' && !itemId.startsWith('new-') ? itemId : ''}`} email={email} month={k} setMonth={setK}>
      {d.error && <div className="banner">Couldn’t load data: {d.error}</div>}
      {d.loaded && !d.me && <div className="banner">Your account is signed in but has no access yet. Ask a Maavel admin to add you.</div>}
      {d.me && !d.canEdit && <div className="banner">You have view-only access. Ask an admin if you need to make changes.</div>}

      {!d.loaded ? <p className="note">Loading…</p> : (
        view === 'home' ? <DashboardView />
          : view === 'month' ? <MonthView k={k} action={itemId} />
          : view === 'staff' ? <StaffView id={itemId} />
          : view === 'payroll' ? <PayrollView k={k} />
          : view === 'estimate' ? <EstimateView k={k} />
          : view === 'projects' ? <ProjectsView id={itemId} />
          : view === 'assets' ? <AssetsView id={itemId} />
          : view === 'company' ? <CompanyView />
          : <TeamView />
      )}
    </Shell>
  )
}
