import { useState, type MouseEvent } from 'react'
import { useData } from '../data/DataContext'
import { useDashboard } from '../data/useDashboard'
import { LEVEL_PILL, taskOrder, type Dashboard } from '../lib/dashboard'
import { Icon, type IconName } from '../components/icons'
import { fmt0, MONTHS, monthName, niceDate, todayStr } from '../lib/format'
import type { Priority, Task } from '../lib/types'
import { ConfirmDelete, Field, Modal, Pill, Section, Tile } from '../components/ui'

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening' }
const short = (k: string) => `${MONTHS[+k.slice(5) - 1].slice(0, 3)}`

export default function DashboardView() {
  const d = useData()
  const x = useDashboard()
  const name = d.me?.full_name?.split(' ')[0]
  const change = x.avg3 ? Math.round(((x.next.total - x.avg3) / x.avg3) * 100) : null
  const urgent = x.alerts.filter(a => a.level === 'bad').length

  return (
    <div className="view">
      <div className="hello">
        <div className="grow">
          <h2 className="greet">{greeting()}{name ? `, ${name}` : ''}</h2>
          <p className="note">{niceDate(todayStr)} · {x.alerts.length ? `${urgent} urgent, ${x.alerts.length - urgent} coming up` : 'Nothing needs your attention right now'}</p>
        </div>
      </div>

      <div className="quick">
        {d.canEdit && <>
          <QuickLink href="#month/expense" icon="plus" label="Add expense" />
          <QuickLink href="#staff/new" icon="staff" label="Add staff" />
          <QuickLink href="#projects/new" icon="projects" label="New project" />
          <QuickLink href="#todo" icon="check" label="Add to-do" onClick={e => { e.preventDefault(); document.getElementById('quick-todo')?.focus() }} />
        </>}
        <button type="button" className="quickbtn" onClick={() => import('../lib/pdf').then(m => m.directorPdf(x))}><Icon name="report" /><span>Director’s report</span></button>
      </div>

      <div className="tiles">
        <Tile label={`Spent in ${MONTHS[+x.k.slice(5) - 1]}`} value={fmt0(x.cur.total)} sub={x.avg3 ? `3-month average ${fmt0(x.avg3)}` : 'Paid so far, MVR'} />
        <Tile label="Still to pay this month" value={fmt0(x.cur.dueTotal)} sub={`${x.cur.unpaid.length} bill${x.cur.unpaid.length === 1 ? '' : 's'}${x.cur.payDue ? ' + payroll' : ''}`} />
        <Tile label={`${monthName(x.nextK)} estimate`} value={fmt0(x.next.total)} sub={change == null ? 'Staff, bills and running costs' : `${change >= 0 ? '+' : ''}${change}% vs 3-month average`} />
        <Tile label="Active staff" value={x.active.length} sub={`${x.expats.length} expat · ${x.onLeave.length} away today`} total />
      </div>

      <div className="board">
        <div className="board-main">
          <Section title="Needs your attention" intro={x.alerts.length ? 'Overdue payments, expiring visas and licences, and late to-dos.' : undefined}>
            {!x.alerts.length ? <p className="allclear">All clear. Nothing overdue or expiring soon.</p> : (
              <ul className="alerts">
                {x.alerts.map((a, i) => (
                  <li key={i} className={a.level}>
                    <a href={a.href}><b>{a.title}</b><span>{a.detail}</span></a>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Tasks />
        </div>

        <div className="board-side">
          <Section title="Next 30 days" intro="Bills, renewals, leave and to-dos.">
            {!x.upcoming.length ? <p className="empty">Nothing due in the next 30 days.</p> : (
              <ul className="timeline">
                {x.upcoming.slice(0, 10).map((u, i) => (
                  <li key={i}>
                    <time dateTime={u.date}><b>{+u.date.slice(8)}</b>{short(u.date.slice(0, 7))}</time>
                    <a href={u.href}><b>{u.title}</b><span>{u.kind} · {u.detail}</span></a>
                    {u.amount != null && <span className="amt">{fmt0(u.amount)}</span>}
                  </li>
                ))}
                {x.upcoming.length > 10 && <li className="more">and {x.upcoming.length - 10} more</li>}
              </ul>
            )}
          </Section>
          <Section title="Who’s away">
            {!x.onLeave.length ? <p className="empty">Everyone is in today.</p> : x.onLeave.map(s => {
              const until = x.leaveUntil(s)
              return <div className="kv" key={s.id}><a className="plain" href={`#staff/${s.id}`}>{s.name}<span className="sub">{s.designation}</span></a><Pill kind="soon">{until ? `Back after ${niceDate(until)}` : 'On leave'}</Pill></div>
            })}
          </Section>
        </div>
      </div>

      <Section title="Overheads" intro={`What Maavel actually paid each month, in MVR. ${x.year} so far: MVR ${fmt0(x.ytdTotal)}.`}
        action={<a className="btnlink" href="#estimate">Open estimate</a>}>
        <TrendChart x={x} />
        <div className="cols">
          <div>
            <h3 className="mini">{x.year} by category</h3>
            <BarList rows={x.ytdRows} total={x.ytdTotal} money />
          </div>
          <div>
            <h3 className="mini">{monthName(x.nextK)} estimate</h3>
            <div className="kv"><span>Salaries ({x.next.st.length} staff)</span><b>{fmt0(x.next.staffBasic)}</b></div>
            <div className="kv"><span>Food & other allowances</span><b>{fmt0(x.next.staffFood + x.next.staffAllow)}</b></div>
            <div className="kv"><span>Rent and bills</span><b>{fmt0(x.next.billsTotal)}</b></div>
            {x.next.extrasTotal > 0 && <div className="kv"><span>Additional items</span><b>{fmt0(x.next.extrasTotal)}</b></div>}
            <div className="kv"><span>Other expenses (3-month average)</span><b>{fmt0(x.next.otherAvg)}</b></div>
            <div className="kv total"><span>Estimated total</span><b>MVR {fmt0(x.next.total)}</b></div>
          </div>
        </div>
      </Section>

      <Section title="People and visas" intro="Headcount, who joined or left, and passport, e-visa, medical and insurance renewals in the next 90 days."
        action={<a className="btnlink" href="#staff">Open staff</a>}>
        <div className="tiles">
          <Tile label="Expatriates" value={x.expats.length} sub={`${x.active.length - x.expats.length} local`} />
          <Tile label="Monthly basic pay" value={fmt0(x.staffBasic)} sub="Active staff, MVR" />
          <Tile label="Renewals in 90 days" value={x.staffDocs.length} sub={`${x.staffDocs.filter(s => s.level === 'bad').length} urgent`} />
          <Tile label="Missing visa dates" value={x.missingDates.length} sub="Expats to update" />
        </div>
        <div className="tablewrap"><table>
          <thead><tr><th>Person and document</th><th>Expires</th></tr></thead>
          <tbody>
            {!x.staffDocs.length ? <tr><td colSpan={2} className="empty">No staff documents expire in the next 90 days.{x.missingDates.length ? ' Some expats have no dates yet, so check the Staff tab.' : ''}</td></tr>
              : x.staffDocs.map((r, i) => (
                <tr key={i}>
                  <td><a className="plain" href={`#staff/${r.staff.id}`}>{r.staff.name}</a><span className="sub">{r.doc} · {r.staff.designation}, {r.staff.country}</span></td>
                  <td className="nowrap">{niceDate(r.date)}<span className="sub"><Pill kind={LEVEL_PILL[r.level]}>{r.text}</Pill></span></td>
                </tr>
              ))}
          </tbody>
        </table></div>
        <div className="cols three">
          <div><h3 className="mini">By country</h3><BarList rows={x.byCountry} total={x.active.length} /></div>
          <div><h3 className="mini">By job</h3><BarList rows={x.byRole} total={x.active.length} /></div>
          <div>
            <h3 className="mini">Last 3 months</h3>
            {!x.joined.length && !x.left.length && <p className="empty">No one joined or left.</p>}
            {x.joined.map(s => <div className="kv" key={s.id}><span>{s.name}<span className="sub">{s.designation}</span></span><Pill kind="paid">Joined {niceDate(s.join_date)}</Pill></div>)}
            {x.left.map(s => <div className="kv" key={s.id}><span>{s.name}<span className="sub">{s.designation}</span></span><Pill kind="left">Left {niceDate(s.left_date)}</Pill></div>)}
          </div>
        </div>
      </Section>

      <div className="cols">
        <Section title="Projects" intro={x.projects.length ? `${x.projects.length} active. Expenses tagged to each project plus salaries of staff on site.` : undefined}
          action={<a className="btnlink" href="#projects">Open projects</a>}>
          {!x.projects.length ? <p className="empty">No active projects. Add your sites to see cost per project.</p> : <div className="tablewrap"><table>
            <thead><tr><th>Project</th><th className="num">This month</th><th className="num">To date</th></tr></thead>
            <tbody>
              {x.projects.slice(0, 6).map(({ p, c, thisMonth }) => (
                <tr key={p.id} className="clickable" onClick={() => { location.hash = `projects/${p.id}` }}>
                  <td>{p.name}<span className="sub">{[p.location, c.pct != null ? `${c.pct}% of ${p.budget ? 'budget' : 'contract'}` : ''].filter(Boolean).join(' · ')}</span></td>
                  <td className="num">{fmt0(thisMonth)}</td>
                  <td className="num">{fmt0(c.total)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>}
        </Section>

      <Section title="Company licences and documents" intro={x.companyDocs.length
        ? `${x.companyDue.length} due for renewal in the next 90 days${x.renewalCost90 ? `, about MVR ${fmt0(x.renewalCost90)} in fees` : ''}.`
        : 'Keep business registration, tax, leases, insurance, vehicle and quota papers here with their expiry dates.'}
        action={<a className="btnlink" href="#company">{x.companyDocs.length ? 'Open company' : 'Add documents'}</a>}>
        {d.missing.includes('company_docs') ? <SetupNote /> : !x.companyDocs.length ? <p className="empty">No company documents added yet.</p> : (
          <div className="tablewrap"><table>
            <thead><tr><th>Document</th><th>Expires</th><th>Status</th></tr></thead>
            <tbody>
              {x.companyDocs.slice(0, 6).map(c => (
                <tr key={c.doc.id}>
                  <td>{c.doc.name}<span className="sub">{c.doc.category}{c.doc.number ? ` · ${c.doc.number}` : ''}</span></td>
                  <td className="nowrap">{c.doc.expiry_date ? niceDate(c.doc.expiry_date) : 'Does not expire'}</td>
                  <td>{c.doc.expiry_date ? <Pill kind={LEVEL_PILL[c.level]}>{c.level === 'ok' ? 'OK' : c.text}</Pill> : <span className="sub">–</span>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Section>
      </div>
    </div>
  )
}

function QuickLink({ href, icon, label, onClick }: { href: string; icon: IconName; label: string; onClick?: (e: MouseEvent) => void }) {
  return <a className="quickbtn" href={href} onClick={onClick}><Icon name={icon} /><span>{label}</span></a>
}

export function SetupNote() {
  return <p className="banner">This part needs a one-time database update. In Supabase, open SQL Editor, paste the “Director dashboard” section from <code>supabase/schema.sql</code> and click Run.</p>
}

/* ---------- 12-month stacked bars ---------- */
function TrendChart({ x }: { x: Dashboard }) {
  const max = Math.max(1, ...x.trend.map(t => t.total))
  const step = niceStep(max)
  const top = Math.ceil(max / step) * step
  const H = 180
  const [hover, setHover] = useState<number | null>(null)
  const shown = hover ?? x.trend.length - 1
  const t = x.trend[shown]
  return (
    <figure className="chart" aria-label="Monthly spend for the last 12 months">
      <figcaption>
        <b>{monthName(t.k)}</b>
        <span><i className="sw staff" />Staff {fmt0(t.staff)}</span>
        <span><i className="sw bills" />Rent & bills {fmt0(t.bills)}</span>
        <span><i className="sw other" />Other {fmt0(t.other)}</span>
        <span className="tot">Total {fmt0(t.total)}</span>
      </figcaption>
      <div className="plot" style={{ height: H }}>
        <div className="grid">{[top, top / 2, 0].map(v => <span key={v}>{fmt0(v / 1000)}k</span>)}</div>
        {x.trend.map((m, i) => (
          <button key={m.k} type="button" className={`bar${i === shown ? ' on' : ''}`} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onClick={() => setHover(i)}
            aria-label={`${monthName(m.k)}: total MVR ${fmt0(m.total)}`}>
            <span className="stack" style={{ height: `calc((100% - 20px) * ${m.total / top})` }}>
              <i className="other" style={{ flexGrow: m.other }} />
              <i className="bills" style={{ flexGrow: m.bills }} />
              <i className="staff" style={{ flexGrow: m.staff }} />
            </span>
            <small>{short(m.k)}</small>
          </button>
        ))}
      </div>
      {x.trend[x.trend.length - 1].total < x.avg3 && <p className="note">This month is still in progress, so its bar is not complete yet.</p>}
    </figure>
  )
}

function niceStep(max: number) {
  const raw = max / 2
  const p = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= raw) ?? raw
}

function BarList({ rows, total, money }: { rows: [string, number][]; total: number; money?: boolean }) {
  if (!rows.length) return <p className="empty">Nothing yet.</p>
  const max = Math.max(...rows.map(r => r[1]))
  return (
    <ul className="barlist">
      {rows.map(([k, v]) => (
        <li key={k}>
          <span className="lbl">{k}</span>
          <span className="val">{money ? fmt0(v) : v}<small>{total ? ` · ${Math.round((v / total) * 100)}%` : ''}</small></span>
          <span className="track"><i style={{ width: `${(v / max) * 100}%` }} /></span>
        </li>
      ))}
    </ul>
  )
}

/* ---------- to-do list ---------- */
const blankTask = (): Task => ({ id: '', title: '', due_date: null, owner: '', priority: 'Normal', done: false, done_date: null, notes: '' })

function Tasks() {
  const d = useData()
  const [edit, setEdit] = useState<Task | null>(null)
  const [quick, setQuick] = useState('')
  const [showDone, setShowDone] = useState(false)
  const open = d.tasks.filter(t => !t.done).sort(taskOrder)
  const done = d.tasks.filter(t => t.done).sort((a, b) => (b.done_date ?? '').localeCompare(a.done_date ?? '')).slice(0, 10)
  const missing = d.missing.includes('tasks')

  async function add() {
    const title = quick.trim()
    if (!title) return
    if (await d.upsert('tasks', { title })) { setQuick(''); d.toast('To-do added') }
  }
  async function toggle(t: Task) {
    await d.upsert('tasks', { id: t.id, title: t.title, done: !t.done, done_date: t.done ? null : todayStr })
  }
  async function save() {
    if (!edit) return
    const { id, created_at: _c, ...rest } = edit
    void _c
    const row = { ...rest, title: rest.title.trim(), owner: rest.owner.trim(), due_date: rest.due_date || null, ...(id ? { id } : {}) }
    if (!row.title) { d.toast('Give the to-do a title.'); return }
    if (await d.upsert('tasks', row)) { setEdit(null); d.toast('Saved') }
  }

  return (
    <Section title="To-do" intro="Renew a quota, follow up a payment, file GST. Anyone with edit access can tick them off."
      action={!missing && <button className="small" disabled={!d.canEdit} onClick={() => setEdit(blankTask())}>Add with details</button>}>
      {missing ? <SetupNote /> : <>
        {d.canEdit && (
          <form className="row" onSubmit={e => { e.preventDefault(); add() }}>
            <Field label="Quick add"><input value={quick} placeholder="e.g. Renew Goidhoo apartment lease" onChange={e => setQuick(e.target.value)} /></Field>
            <button type="submit" disabled={!quick.trim()}>Add</button>
          </form>
        )}
        {!open.length ? <p className="empty">No open to-dos.</p> : (
          <ul className="todos">
            {open.map(t => {
              const late = t.due_date && t.due_date < todayStr
              return (
                <li key={t.id}>
                  <input type="checkbox" aria-label={`Mark “${t.title}” done`} checked={false} disabled={!d.canEdit} onChange={() => toggle(t)} />
                  <button type="button" className="link plain" onClick={() => setEdit(t)}>
                    {t.title}
                    <span className="sub">{[t.due_date ? `Due ${niceDate(t.due_date)}` : 'No due date', t.owner && `For ${t.owner}`].filter(Boolean).join(' · ')}</span>
                  </button>
                  {late ? <Pill kind="overdue">Overdue</Pill> : t.priority === 'High' ? <Pill kind="soon">High</Pill> : null}
                </li>
              )
            })}
          </ul>
        )}
        {done.length > 0 && <button type="button" className="link" onClick={() => setShowDone(s => !s)}>{showDone ? 'Hide' : 'Show'} recently done ({done.length})</button>}
        {showDone && (
          <ul className="todos done">
            {done.map(t => (
              <li key={t.id}>
                <input type="checkbox" aria-label={`Mark “${t.title}” not done`} checked disabled={!d.canEdit} onChange={() => toggle(t)} />
                <span>{t.title}<span className="sub">Done {niceDate(t.done_date)}</span></span>
              </li>
            ))}
          </ul>
        )}
      </>}
      <Modal open={!!edit} title={edit?.id ? 'Edit to-do' : 'New to-do'} onClose={() => setEdit(null)} onSubmit={save}
        footer={edit?.id ? <ConfirmDelete onConfirm={async () => { if (await d.remove('tasks', edit.id)) { setEdit(null); d.toast('Deleted') } }} /> : undefined}>
        {edit && <fieldset disabled={!d.canEdit}>
          <Field label="What needs doing"><input required value={edit.title} onChange={e => setEdit({ ...edit, title: e.target.value })} /></Field>
          <div className="grid2">
            <Field label="Due date"><input type="date" value={edit.due_date ?? ''} onChange={e => setEdit({ ...edit, due_date: e.target.value || null })} /></Field>
            <Field label="Priority"><select value={edit.priority} onChange={e => setEdit({ ...edit, priority: e.target.value as Priority })}>
              <option>High</option><option>Normal</option><option>Low</option>
            </select></Field>
          </div>
          <Field label="Who should do it"><input value={edit.owner} placeholder="e.g. Mariyam (HR)" onChange={e => setEdit({ ...edit, owner: e.target.value })} /></Field>
          <Field label="Notes"><input value={edit.notes} onChange={e => setEdit({ ...edit, notes: e.target.value })} /></Field>
          {edit.id && <label className="check"><input type="checkbox" checked={edit.done} onChange={e => setEdit({ ...edit, done: e.target.checked, done_date: e.target.checked ? todayStr : null })} /> Done</label>}
        </fieldset>}
      </Modal>
    </Section>
  )
}
