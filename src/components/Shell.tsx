import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useData } from '../data/DataContext'
import { useDashboard } from '../data/useDashboard'
import { MONTHS, niceDate, shiftMonth } from '../lib/format'
import { applyTheme, pref, savedTheme, setPref, type ThemeChoice } from '../lib/theme'
import { Icon, type IconName } from './icons'

export type View = 'home' | 'month' | 'staff' | 'payroll' | 'estimate' | 'projects' | 'company' | 'team'

const NAV: { group: string; items: { id: View; label: string; icon: IconName }[] }[] = [
  { group: '', items: [{ id: 'home', label: 'Overview', icon: 'home' }] },
  { group: 'Money', items: [
    { id: 'month', label: 'Bills & expenses', icon: 'month' },
    { id: 'payroll', label: 'Payroll', icon: 'payroll' },
    { id: 'estimate', label: 'Estimate', icon: 'estimate' },
    { id: 'projects', label: 'Projects', icon: 'projects' },
  ] },
  { group: 'People', items: [
    { id: 'staff', label: 'Staff & visas', icon: 'staff' },
    { id: 'team', label: 'Team & logins', icon: 'team' },
  ] },
  { group: 'Company', items: [{ id: 'company', label: 'Licences & documents', icon: 'company' }] },
]
const ALL = NAV.flatMap(g => g.items)
const MOBILE: View[] = ['home', 'month', 'staff', 'projects']
const labelOf = (v: View) => ALL.find(i => i.id === v)?.label ?? ''

export default function Shell({ view, email, month, setMonth, children }: {
  view: View; email: string; month: string; setMonth: (k: string) => void; children: ReactNode
}) {
  const d = useData()
  const [collapsed, setCollapsed] = useState(() => pref('sidebar-collapsed', false))
  const [drawer, setDrawer] = useState(false)
  const showMonth = view === 'month' || view === 'payroll' || view === 'estimate'

  // Close the phone menu whenever the page changes.
  const [lastView, setLastView] = useState(view)
  if (view !== lastView) { setLastView(view); setDrawer(false) }
  useEffect(() => {
    if (!drawer) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawer(false) }
    addEventListener('keydown', esc)
    return () => removeEventListener('keydown', esc)
  }, [drawer])

  const toggle = () => setCollapsed(c => { setPref('sidebar-collapsed', !c); return !c })
  const name = d.me?.full_name || email

  return (
    <div className={`app${collapsed ? ' collapsed' : ''}${drawer ? ' drawer-open' : ''}`}>
      <aside className="side" aria-label="Main menu">
        <div className="side-brand">
          <img src="/logo.jpg" alt="" />
          <div className="brand"><b>MAAVEL</b><span>Office</span></div>
          <button className="iconbtn only-phone" aria-label="Close menu" onClick={() => setDrawer(false)}><Icon name="close" /></button>
        </div>
        <nav className="side-nav">
          {NAV.map(g => (
            <div key={g.group || 'main'} className="side-group">
              {g.group && <p className="side-label">{g.group}</p>}
              {g.items.map(i => (
                <a key={i.id} href={`#${i.id}`} aria-current={view === i.id ? 'page' : undefined} title={collapsed ? i.label : undefined}>
                  <Icon name={i.icon} /><span>{i.label}</span>
                </a>
              ))}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          <ThemeSwitch />
          <div className="me">
            <span className="initials" aria-hidden>{initials(name)}</span>
            <span className="who"><b>{name}</b><small>{d.me ? d.me.role : 'no access'}</small></span>
            <button className="iconbtn" aria-label="Sign out" title="Sign out" onClick={() => supabase.auth.signOut()}><Icon name="logout" size={18} /></button>
          </div>
          <button className="side-collapse only-desk" onClick={toggle} aria-label={collapsed ? 'Expand menu' : 'Collapse menu'} title={collapsed ? 'Expand menu' : 'Collapse menu'}>
            <Icon name={collapsed ? 'expand' : 'collapse'} size={18} /><span>Collapse</span>
          </button>
        </div>
      </aside>
      <div className="scrim" onClick={() => setDrawer(false)} aria-hidden />

      <div className="main">
        <header className="topbar">
          <button className="iconbtn only-phone" aria-label="Open menu" onClick={() => setDrawer(true)}><Icon name="menu" /></button>
          <h1 className="page-title">{labelOf(view)}</h1>
          {showMonth && (
            <div className="monthbar">
              <button className="iconbtn" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}><Icon name="chevron" className="flip" size={18} /></button>
              <b>{MONTHS[+month.slice(5) - 1].slice(0, 3)} {month.slice(0, 4)}</b>
              <button className="iconbtn" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}><Icon name="chevron" size={18} /></button>
            </div>
          )}
          <div className="grow" />
          <Search />
          <Notifications userId={d.me?.id ?? 'x'} />
          <QuickTheme />
        </header>

        <main className="content">{children}</main>
      </div>

      <nav className="bottombar" aria-label="Quick menu">
        {MOBILE.map(id => {
          const i = ALL.find(x => x.id === id)!
          return <a key={id} href={`#${id}`} aria-current={view === id ? 'page' : undefined}><Icon name={i.icon} /><span>{id === 'home' ? 'Overview' : id === 'month' ? 'Bills' : id === 'staff' ? 'Staff' : 'Projects'}</span></a>
        })}
        <button type="button" onClick={() => setDrawer(true)} aria-current={!MOBILE.includes(view) ? 'page' : undefined}><Icon name="menu" /><span>More</span></button>
      </nav>
      <div className={`toast${d.toastMsg ? ' show' : ''}`} role="status">{d.toastMsg}</div>
    </div>
  )
}

const initials = (s: string) => s.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?'

/* ---------- theme ---------- */
function useTheme(): [ThemeChoice, (t: ThemeChoice) => void] {
  const [t, setT] = useState<ThemeChoice>(savedTheme)
  useEffect(() => {
    const sync = () => setT(savedTheme())
    addEventListener('maavel-theme', sync)
    return () => removeEventListener('maavel-theme', sync)
  }, [])
  return [t, v => { applyTheme(v); setT(v); dispatchEvent(new Event('maavel-theme')) }]
}

function ThemeSwitch() {
  const [t, set] = useTheme()
  const opts: [ThemeChoice, string, IconName][] = [['light', 'Light', 'sun'], ['dark', 'Dark', 'moon'], ['auto', 'Auto', 'auto']]
  return (
    <div className="seg" role="radiogroup" aria-label="Colour theme">
      {opts.map(([v, label, icon]) => (
        <button key={v} role="radio" aria-checked={t === v} title={v === 'auto' ? 'Follow this device' : label} onClick={() => set(v)}>
          <Icon name={icon} size={16} /><span>{label}</span>
        </button>
      ))}
    </div>
  )
}

function QuickTheme() {
  const [t, set] = useTheme()
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches)
  return <button className="iconbtn" aria-label={dark ? 'Switch to light' : 'Switch to dark'} title={dark ? 'Light mode' : 'Dark mode'} onClick={() => set(dark ? 'light' : 'dark')}><Icon name={dark ? 'sun' : 'moon'} /></button>
}

/* ---------- notifications ---------- */
function Notifications({ userId }: { userId: string }) {
  const x = useDashboard()
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState<string[]>(() => pref(`seen-${userId}`, []))
  const ref = useRef<HTMLDivElement>(null)
  const key = (a: { title: string; detail: string }) => `${a.title}|${a.detail}`.slice(0, 160)
  const unseen = x.alerts.filter(a => !seen.includes(key(a)))
  const soon = x.upcoming.filter(u => u.date <= shiftDate(7))

  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    addEventListener('mousedown', off); addEventListener('keydown', esc)
    return () => { removeEventListener('mousedown', off); removeEventListener('keydown', esc) }
  }, [open])

  function markRead() {
    const all = x.alerts.map(key)
    setSeen(all); setPref(`seen-${userId}`, all)
  }

  return (
    <div className="pop" ref={ref}>
      <button className="iconbtn" aria-label={`Notifications${unseen.length ? `, ${unseen.length} new` : ''}`} aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <Icon name="bell" />{unseen.length > 0 && <span className="badge">{unseen.length > 9 ? '9+' : unseen.length}</span>}
      </button>
      {open && (
        <div className="panel-pop notif" role="dialog" aria-label="Notifications">
          <div className="pop-head"><b>Notifications</b>{unseen.length > 0 && <button className="link" onClick={markRead}>Mark all read</button>}</div>
          {!x.alerts.length && !soon.length && <p className="allclear">All clear. Nothing overdue or expiring soon.</p>}
          {x.alerts.length > 0 && (
            <ul className="notes">
              {x.alerts.map(a => (
                <li key={key(a)} className={`${a.level}${seen.includes(key(a)) ? ' seen' : ''}`}>
                  <a href={a.href} onClick={() => setOpen(false)}><Icon name="alert" size={16} /><span><b>{a.title}</b><small>{a.detail}</small></span></a>
                </li>
              ))}
            </ul>
          )}
          {soon.length > 0 && <>
            <p className="side-label">This week</p>
            <ul className="notes">
              {soon.map((u, i) => (
                <li key={i}><a href={u.href} onClick={() => setOpen(false)}><Icon name="month" size={16} /><span><b>{u.title}</b><small>{u.kind} · {niceDate(u.date)}</small></span></a></li>
              ))}
            </ul>
          </>}
        </div>
      )}
    </div>
  )
}
const shiftDate = (days: number) => { const t = new Date(); t.setDate(t.getDate() + days); return t.toISOString().slice(0, 10) }

/* ---------- search ---------- */
type Hit = { href: string; title: string; sub: string; icon: IconName }

function Search() {
  const d = useData()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const slash = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(t.tagName)) { e.preventDefault(); input.current?.focus(); setOpen(true) }
    }
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    addEventListener('keydown', slash); addEventListener('mousedown', off)
    return () => { removeEventListener('keydown', slash); removeEventListener('mousedown', off) }
  }, [])

  const hits = useMemo<Hit[]>(() => {
    const t = q.trim().toLowerCase()
    if (t.length < 2) return []
    const has = (...v: (string | null | undefined)[]) => v.join(' ').toLowerCase().includes(t)
    return [
      ...d.staff.filter(s => has(s.name, s.designation, s.passport_no, s.wp_no, s.visa_no, s.phone, s.country))
        .map(s => ({ href: `#staff/${s.id}`, title: s.name, sub: `Staff · ${[s.designation, s.status === 'Left' ? 'left' : ''].filter(Boolean).join(', ')}`, icon: 'staff' as IconName })),
      ...d.projects.filter(p => has(p.name, p.client, p.location)).map(p => ({ href: `#projects/${p.id}`, title: p.name, sub: `Project · ${p.status}`, icon: 'projects' as IconName })),
      ...d.company_docs.filter(c => has(c.name, c.number, c.issuer, c.category)).map(c => ({ href: '#company', title: c.name, sub: `Company document · ${c.category}`, icon: 'company' as IconName })),
      ...d.bills.filter(b => has(b.name, b.provider, b.account)).map(b => ({ href: '#month', title: b.name, sub: `Bill · ${b.category}`, icon: 'month' as IconName })),
      ...d.tasks.filter(x => !x.done && has(x.title, x.owner)).map(x => ({ href: '#home', title: x.title, sub: 'To-do', icon: 'check' as IconName })),
    ].slice(0, 12)
  }, [q, d.staff, d.projects, d.company_docs, d.bills, d.tasks])

  function go(h: Hit) { location.hash = h.href.slice(1); setQ(''); setOpen(false); input.current?.blur() }

  return (
    <div className={`pop search${open ? ' open' : ''}`} ref={ref}>
      <label className="searchbox">
        <Icon name="search" size={18} />
        <input ref={input} type="search" value={q} placeholder="Search staff, projects…" aria-label="Search"
          onFocus={() => setOpen(true)} onChange={e => { setQ(e.target.value); setActive(0); setOpen(true) }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, hits.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
            else if (e.key === 'Enter' && hits[active]) go(hits[active])
            else if (e.key === 'Escape') { setOpen(false); input.current?.blur() }
          }} />
        <kbd className="only-desk">/</kbd>
      </label>
      {open && q.trim().length >= 2 && (
        <div className="panel-pop results" role="listbox" aria-label="Search results">
          {!hits.length ? <p className="empty">Nothing found for “{q.trim()}”.</p> : hits.map((h, i) => (
            <a key={h.href + h.title} href={h.href} role="option" aria-selected={i === active} className={i === active ? 'on' : ''}
              onMouseEnter={() => setActive(i)} onClick={e => { e.preventDefault(); go(h) }}>
              <Icon name={h.icon} size={18} /><span><b>{h.title}</b><small>{h.sub}</small></span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
