import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { useData } from '../data/DataContext'
import { byOrder, isActive } from '../lib/calc'
import { fmt, fmt0, monthName, niceDate, num, thisMonth } from '../lib/format'
import { removeAllFiles } from '../lib/files'
import { projectCost, projectSpendIn } from '../lib/projects'
import { PROJECT_FILE_KINDS, type Project, type ProjectStatus } from '../lib/types'
import { ConfirmDelete, Empty, Field, Modal, Pill, Section, Tile } from '../components/ui'
import Files from '../components/Files'

const STATUS_PILL: Record<ProjectStatus, string> = { Active: 'paid', 'On hold': 'soon', Completed: 'left' }
const blank = (): Project => ({ id: '', name: '', client: '', location: '', status: 'Active', start_date: null, end_date: null, contract_value: null, budget: null, notes: '' })

export default function ProjectsView({ id }: { id: string | null }) {
  const d = useData()
  const [edit, setEdit] = useState<Project | null>(null)
  const [show, setShow] = useState<'open' | 'all'>('open')

  const rows = useMemo(() => d.projects.map(p => ({ p, c: projectCost(p, d.payments, d.payroll_months) })), [d.projects, d.payments, d.payroll_months])

  if (d.missing.includes('projects')) return (
    <div className="view"><Section title="Projects and sites"><p className="note">Projects need the latest database update. Run the newest section of <code>supabase/schema.sql</code> in the Supabase SQL Editor, then reload.</p></Section></div>
  )

  async function save() {
    if (!edit) return
    if (!edit.name.trim()) { d.toast('Give the project a name.'); return }
    const { id: pid, ...rest } = edit
    const row = { ...rest, name: rest.name.trim(), client: rest.client.trim(), location: rest.location.trim(), notes: rest.notes.trim(), start_date: rest.start_date || null, end_date: rest.end_date || null, ...(pid ? { id: pid } : {}) }
    if (await d.upsert('projects', row)) { setEdit(null); d.toast('Project saved') }
  }

  const dialog = (
    <Modal wide open={!!edit} title={edit?.id ? 'Edit project' : 'New project'} onClose={() => setEdit(null)} onSubmit={save}
      footer={edit?.id ? <ConfirmDelete label="Delete project" onConfirm={async () => {
        await removeAllFiles(d.files, 'project', edit.id)
        if (await d.remove('projects', edit.id)) { setEdit(null); d.reload('files'); d.reload('payments'); d.reload('staff'); location.hash = 'projects'; d.toast('Project deleted. Its expenses are kept as general overheads.') }
      }} /> : undefined}>
      {edit && <fieldset disabled={!d.canEdit}>
        <Field label="Project name"><input required value={edit.name} placeholder="e.g. Hulhumalé 6-storey building" onChange={e => setEdit({ ...edit, name: e.target.value })} /></Field>
        <div className="grid2">
          <Field label="Client"><input value={edit.client} onChange={e => setEdit({ ...edit, client: e.target.value })} /></Field>
          <Field label="Island / location"><input value={edit.location} placeholder="e.g. Malé, Goidhoo" onChange={e => setEdit({ ...edit, location: e.target.value })} /></Field>
          <Field label="Status"><select value={edit.status} onChange={e => setEdit({ ...edit, status: e.target.value as ProjectStatus })}>
            <option>Active</option><option>On hold</option><option>Completed</option>
          </select></Field>
          <Field label="Contract value (MVR)"><input type="number" min="0" inputMode="decimal" value={edit.contract_value ?? ''} onChange={e => setEdit({ ...edit, contract_value: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
          <Field label="Cost budget (MVR)"><input type="number" min="0" inputMode="decimal" value={edit.budget ?? ''} placeholder="What you plan to spend" onChange={e => setEdit({ ...edit, budget: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
          <Field label="Start"><input type="date" value={edit.start_date ?? ''} onChange={e => setEdit({ ...edit, start_date: e.target.value || null })} /></Field>
          <Field label="Finish (planned or actual)"><input type="date" value={edit.end_date ?? ''} onChange={e => setEdit({ ...edit, end_date: e.target.value || null })} /></Field>
        </div>
        <Field label="Notes"><input value={edit.notes} onChange={e => setEdit({ ...edit, notes: e.target.value })} /></Field>
      </fieldset>}
    </Modal>
  )

  if (id) {
    const r = rows.find(x => x.p.id === id)
    if (!r) return <div className="view"><Section title="Not found"><p className="note">This project was deleted. <a href="#projects">Back to projects</a></p></Section></div>
    return <ProjectPage p={r.p} c={r.c} onEdit={() => setEdit(r.p)} dialog={dialog} />
  }

  const list = rows.filter(r => show === 'all' || r.p.status !== 'Completed')
    .sort((a, b) => (a.p.status === b.p.status ? 0 : a.p.status === 'Active' ? -1 : b.p.status === 'Active' ? 1 : 0) || b.c.total - a.c.total)
  const active = rows.filter(r => r.p.status === 'Active')
  const month = active.reduce((a, r) => a + projectSpendIn(r.c, thisMonth), 0)
  const staffOnSite = d.staff.filter(s => isActive(s) && s.project_id).length

  return (
    <div className="view">
      <div className="tiles">
        <Tile label="Active projects" value={active.length} sub={`${rows.length} in total`} />
        <Tile label="Spent this month" value={fmt0(month)} sub={`${monthName(thisMonth)}, MVR`} />
        <Tile label="Staff on sites" value={staffOnSite} sub={`of ${d.staff.filter(isActive).length} active staff`} />
        <Tile label="Active spend to date" value={fmt0(active.reduce((a, r) => a + r.c.total, 0))} sub="MVR, expenses + salaries" total />
      </div>
      <Section title="Projects and sites" intro="Tag expenses and staff to a project to see what each one really costs. Salaries count once a salary sheet built in the app is marked paid."
        action={<button className="primary" disabled={!d.canEdit} onClick={() => setEdit(blank())}>New project</button>}>
        {rows.length > 0 && <div className="toolbar"><Field label="Show"><select value={show} onChange={e => setShow(e.target.value as 'open' | 'all')}>
          <option value="open">Active and on hold</option><option value="all">All, including completed</option>
        </select></Field></div>}
        <div className="tablewrap"><table>
          <thead><tr><th>Project</th><th className="hide-sm">Status</th><th className="num">Spent</th><th className="hide-sm">Of budget</th></tr></thead>
          <tbody>
            {!list.length ? <Empty cols={4}>{rows.length ? 'Nothing to show.' : 'No projects yet. Tap New project to add your first site.'}</Empty> : list.map(({ p, c }) => (
              <tr key={p.id} className="clickable" onClick={() => { location.hash = `projects/${p.id}` }}>
                <td><a className="link plain" href={`#projects/${p.id}`} onClick={e => e.stopPropagation()}>{p.name}</a>
                  <span className="sub">{[p.location, p.client].filter(Boolean).join(' · ')}<span className="show-sm"> · {p.status}</span></span></td>
                <td className="hide-sm"><Pill kind={STATUS_PILL[p.status]}>{p.status}</Pill></td>
                <td className="num">{fmt0(c.total)}</td>
                <td className="hide-sm">{c.pct != null ? <Progress pct={c.pct} /> : <span className="sub">No budget</span>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Section>
      {dialog}
    </div>
  )
}

function Progress({ pct }: { pct: number }) {
  return <span className={`progress${pct > 100 ? ' over' : pct > 85 ? ' near' : ''}`} title={`${pct}%`}><i style={{ width: `${Math.min(100, pct)}%` }} /><b>{pct}%</b></span>
}

function ProjectPage({ p, c, onEdit, dialog }: { p: Project; c: ReturnType<typeof projectCost>; onEdit: () => void; dialog: ReactNode }) {
  const d = useData()
  const team = d.staff.filter(s => isActive(s) && s.project_id === p.id).sort(byOrder)
  const max = Math.max(1, ...c.months.map(m => m[1] + m[2]))

  return (
    <div className="view">
      <p className="crumbs"><a href="#projects">‹ All projects</a></p>
      <section className="profile-head">
        <div className="grow">
          <h2>{p.name}</h2>
          <p>{[p.client && `Client: ${p.client}`, p.location, p.start_date && `${niceDate(p.start_date)} – ${p.end_date ? niceDate(p.end_date) : 'ongoing'}`].filter(Boolean).join(' · ')}</p>
          <p className="pills"><Pill kind={STATUS_PILL[p.status]}>{p.status}</Pill></p>
        </div>
        <div className="head-actions">
          <button onClick={() => import('../lib/pdf').then(m => m.projectPdf(p, c, team))}>Download PDF</button>
          <button className="primary" disabled={!d.canEdit} onClick={onEdit}>Edit</button>
        </div>
      </section>

      <div className="tiles">
        <Tile label="Spent to date" value={fmt0(c.total)} sub="MVR" />
        <Tile label="Expenses" value={fmt0(c.expenses)} sub={`${c.payments.length} payment${c.payments.length === 1 ? '' : 's'}`} />
        <Tile label="Salaries" value={fmt0(c.staff)} sub="Staff on this site" />
        <Tile label={p.budget ? 'Budget left' : p.contract_value ? 'Contract value left' : 'Budget'} value={c.limit ? fmt0(c.limit - c.total) : '–'} sub={c.pct != null ? `${c.pct}% used` : 'Add a budget to track it'} total />
      </div>

      <div className="cols">
        <Section title="Spend by month">
          {!c.months.length ? <p className="empty">Nothing spent yet.</p> : (
            <ul className="barlist">
              {c.months.slice(-12).map(([k, e, s]) => (
                <li key={k}>
                  <span className="lbl">{monthName(k)}</span>
                  <span className="val">{fmt0(e + s)}<small>{s ? ` · salaries ${fmt0(s)}` : ''}</small></span>
                  <span className="track"><i style={{ width: `${((e + s) / max) * 100}%` }} /></span>
                </li>
              ))}
            </ul>
          )}
          {c.byCategory.length > 0 && <>
            <h3 className="mini">Expenses by category</h3>
            <dl className="facts">{c.byCategory.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{fmt0(v)}</dd></Fragment>)}</dl>
          </>}
        </Section>
        <Section title="Staff on this site" intro="Change someone’s site from their profile (Edit details).">
          {!team.length ? <p className="empty">Nobody assigned yet.</p> : team.map(s => (
            <div className="kv" key={s.id}><a className="plain" href={`#staff/${s.id}`}>{s.name}<span className="sub">{s.designation}</span></a><span>{fmt0(num(s.basic) + num(s.food) + num(s.allowance))}</span></div>
          ))}
        </Section>
      </div>

      <Section title="Expenses" intro="Add these from the Month tab (Add expense) and choose this project.">
        <div className="tablewrap"><table>
          <thead><tr><th>Date</th><th>Item</th><th className="hide-sm">Category</th><th className="num">Amount</th></tr></thead>
          <tbody>
            {!c.payments.length ? <Empty cols={4}>No expenses tagged to this project yet.</Empty> : c.payments.map(x => (
              <tr key={x.id}><td className="nowrap">{niceDate(x.date)}</td><td>{x.description}{x.ref && <span className="sub">Ref {x.ref}</span>}</td><td className="hide-sm cat">{x.category}</td><td className="num">{fmt(x.amount)}</td></tr>
            ))}
          </tbody>
        </table></div>
      </Section>

      <Section title="Project files" intro="Contracts, drawings, quotations, invoices and site photos.">
        <Files ownerType="project" ownerId={p.id} kinds={PROJECT_FILE_KINDS} />
      </Section>
      {p.notes && <Section title="Notes"><p className="note">{p.notes}</p></Section>}
      {dialog}
    </div>
  )
}
