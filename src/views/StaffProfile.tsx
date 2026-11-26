import { useMemo, useState } from 'react'
import { useData } from '../data/DataContext'
import { isActive, isLocal, leaveDays, leaveSummary, lineTotal, onLeaveOn } from '../lib/calc'
import { expiryLevel, LEVEL_PILL } from '../lib/dashboard'
import { fmt0, monthName, niceDate, num, todayStr } from '../lib/format'
import { LEAVE_TYPES, type Leave, type LeaveType, type Staff } from '../lib/types'
import { ConfirmDelete, Empty, Field, Modal, Pill, Section } from '../components/ui'
import Files, { EditablePhoto } from '../components/Files'
import { StaffDialog } from './StaffView'

/** Each document row: the expiry/number fields on the staff record and the file kind for its scans. */
const DOC_ROWS: { label: string; kind: string; no?: keyof Staff; exp?: keyof Staff }[] = [
  { label: 'Passport', kind: 'Passport copy', no: 'passport_no', exp: 'passport_exp' },
  { label: 'E-visa', kind: 'E-visa', no: 'visa_no', exp: 'visa_exp' },
  { label: 'Medical', kind: 'Medical', exp: 'medical_exp' },
  { label: 'Insurance', kind: 'Insurance', exp: 'insurance_exp' },
]

export default function StaffProfile({ s }: { s: Staff }) {
  const d = useData()
  const [editing, setEditing] = useState(false)
  const [leave, setLeave] = useState<Leave | null>(null)
  const year = todayStr.slice(0, 4)
  const project = d.projects.find(p => p.id === s.project_id)
  const leaveReady = !d.missing.includes('leaves')

  const pay = useMemo(() => d.payroll_months
    .filter(m => m.lines?.some(l => l.staffId === s.id))
    .map(m => ({ m, l: m.lines!.find(l => l.staffId === s.id)! }))
    .sort((a, b) => b.m.month.localeCompare(a.m.month)), [d.payroll_months, s.id])

  const myLeave = d.leaves.filter(l => l.staff_id === s.id).sort((a, b) => b.start_date.localeCompare(a.start_date))
  const sum = leaveSummary(s, d.leaves, year)
  const awayNow = onLeaveOn(myLeave).length > 0

  async function saveLeave() {
    if (!leave) return
    if (!leave.start_date || !leave.end_date) { d.toast('Enter the first and last day.'); return }
    if (leave.end_date < leave.start_date) { d.toast('The last day is before the first day.'); return }
    const { id, ...rest } = leave
    if (await d.upsert('leaves', { ...rest, notes: rest.notes.trim(), ...(id ? { id } : {}) })) { setLeave(null); d.toast('Leave saved') }
  }
  const newLeave = (): Leave => ({ id: '', staff_id: s.id, type: 'Annual', start_date: todayStr, end_date: todayStr, days: 1, notes: '' })
  const setDates = (l: Leave, start: string, end: string) => setLeave({ ...l, start_date: start, end_date: end, days: leaveDays(start, end) || l.days })

  return (
    <div className="view">
      <p className="crumbs"><a href="#staff">‹ All staff</a></p>

      <section className="profile-head">
        <EditablePhoto ownerId={s.id} name={s.name} />
        <div className="grow">
          <h2>{s.name}</h2>
          <p>{[s.designation, s.country].filter(Boolean).join(' · ')}</p>
          <p className="pills">
            <Pill kind={!isActive(s) ? 'left' : awayNow || s.status === 'On leave' ? 'soon' : 'paid'}>{!isActive(s) ? `Left${s.left_date ? ` ${niceDate(s.left_date)}` : ''}` : awayNow ? 'On leave today' : s.status}</Pill>
            {project && <a className="pill upcoming" href={`#projects/${project.id}`}>{project.name}</a>}
          </p>
        </div>
        <div className="head-actions"><button className="primary" disabled={!d.canEdit} onClick={() => setEditing(true)}>Edit details</button></div>
      </section>

      <div className="cols">
        <Section title="Details">
          <dl className="facts">
            <dt>Phone</dt><dd>{s.phone ? <a href={`tel:${s.phone}`}>{s.phone}</a> : '–'}</dd>
            <dt>Joined</dt><dd>{s.join_date ? niceDate(s.join_date) : '–'}</dd>
            <dt>Emergency contact</dt><dd>{s.emergency_contact || '–'}</dd>
            <dt>Basic salary</dt><dd>MVR {fmt0(s.basic)}</dd>
            <dt>Food allowance</dt><dd>MVR {fmt0(s.food)}</dd>
            <dt>Other allowance</dt><dd>MVR {fmt0(s.allowance)}</dd>
            <dt>Monthly total</dt><dd><b>MVR {fmt0(num(s.basic) + num(s.food) + num(s.allowance))}</b></dd>
          </dl>
          {s.notes && <p className="note">{s.notes}</p>}
          <h3 className="mini">Photos</h3>
          <Files ownerType="staff" ownerId={s.id} kinds={['Profile photo', 'Passport photo']} empty="Tap the photo at the top to add a profile picture." />
        </Section>

        <Section title="Documents" intro={isLocal(s) ? 'Maldivian staff usually only need ID and medical.' : 'Expiry dates warn 60 days ahead. Tap a file to open it.'}>
          <ul className="docrows">
            {DOC_ROWS.map(r => {
              const exp = r.exp ? (s[r.exp] as string | null) : null
              const e = expiryLevel(exp)
              const no = r.no ? (s[r.no] as string | undefined) : ''
              return (
                <li key={r.label}>
                  <div className="dochead">
                    <b>{r.label}</b>
                    <span className="sub">{[no, exp ? `expires ${niceDate(exp)}` : 'no expiry date'].filter(Boolean).join(' · ')}</span>
                    {exp && <Pill kind={LEVEL_PILL[e.level]}>{e.level === 'ok' ? 'OK' : e.text}</Pill>}
                  </div>
                  <Files ownerType="staff" ownerId={s.id} kinds={[r.kind]} compact />
                </li>
              )
            })}
          </ul>
          <h3 className="mini">Other documents</h3>
          <Files ownerType="staff" ownerId={s.id} kinds={['Contract', 'Other']} empty="Contracts, certificates, letters…" />
        </Section>
      </div>

      <Section title="Leave" intro={leaveReady ? `${year}: annual leave ${sum.annual} of ${sum.entitled} days used, sick leave ${sum.sick} of 15.` : undefined}
        action={leaveReady ? <button className="primary" disabled={!d.canEdit} onClick={() => setLeave(newLeave())}>Add leave</button> : undefined}>
        {!leaveReady ? <p className="note">Leave records need the latest database update. Run the newest section of <code>supabase/schema.sql</code> in Supabase.</p> : <>
          <div className="tiles small">
            <div className="tile"><small>Annual left</small><strong>{sum.annualLeft}</strong><em>of {sum.entitled} days</em></div>
            <div className="tile"><small>Sick left</small><strong>{sum.sickLeft}</strong><em>of 15 days</em></div>
            <div className="tile"><small>Other leave</small><strong>{sum.other}</strong><em>days this year</em></div>
          </div>
          <div className="tablewrap"><table>
            <thead><tr><th>Dates</th><th>Type</th><th className="num">Days</th></tr></thead>
            <tbody>
              {!myLeave.length ? <Empty cols={3}>No leave recorded.</Empty> : myLeave.map(l => (
                <tr key={l.id} className="clickable" onClick={() => setLeave(l)}>
                  <td>{niceDate(l.start_date)}{l.end_date !== l.start_date && ` – ${niceDate(l.end_date)}`}{l.notes && <span className="sub">{l.notes}</span>}</td>
                  <td>{l.type}</td>
                  <td className="num">{fmt0(l.days)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </>}
      </Section>

      <Section title="Pay history" intro="From salary sheets built in the app. Months imported as totals only aren’t listed per person.">
        <div className="tablewrap"><table>
          <thead><tr><th>Month</th><th className="num">Basic</th><th className="num hide-sm">Extra / deductions</th><th className="num">Total paid</th></tr></thead>
          <tbody>
            {!pay.length ? <Empty cols={4}>No salary sheets with this person yet.</Empty> : pay.map(({ m, l }) => (
              <tr key={m.month}>
                <td>{monthName(m.month)}{m.pay_status !== 'paid' && <span className="sub">draft</span>}</td>
                <td className="num">{fmt0(l.basic)}</td>
                <td className="num hide-sm">{num(l.extra) || num(l.deduction) ? `+${fmt0(l.extra)} / −${fmt0(l.deduction)}` : '–'}</td>
                <td className="num">{fmt0(lineTotal(l))}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Section>

      <StaffDialog staff={editing ? s : null} onClose={() => setEditing(false)} />

      <Modal open={!!leave} title={leave?.id ? 'Edit leave' : `Leave for ${s.name}`} onClose={() => setLeave(null)} onSubmit={saveLeave}
        footer={leave?.id ? <ConfirmDelete onConfirm={async () => { if (await d.remove('leaves', leave.id)) { setLeave(null); d.toast('Leave deleted') } }} /> : undefined}>
        {leave && <fieldset disabled={!d.canEdit}>
          <Field label="Type"><select value={leave.type} onChange={e => setLeave({ ...leave, type: e.target.value as LeaveType })}>
            {LEAVE_TYPES.map(t => <option key={t}>{t}</option>)}
          </select></Field>
          <div className="grid2">
            <Field label="First day"><input type="date" required value={leave.start_date} onChange={e => setDates(leave, e.target.value, leave.end_date < e.target.value ? e.target.value : leave.end_date)} /></Field>
            <Field label="Last day"><input type="date" required value={leave.end_date} onChange={e => setDates(leave, leave.start_date, e.target.value)} /></Field>
          </div>
          <Field label="Days counted"><input type="number" min="0" step="0.5" inputMode="decimal" value={leave.days} onChange={e => setLeave({ ...leave, days: Number(e.target.value) })} /></Field>
          <p className="note">Days are filled in from the dates. Change it for half days or if Fridays and holidays don’t count.</p>
          <Field label="Notes"><input value={leave.notes} placeholder="e.g. Going home to Bangladesh" onChange={e => setLeave({ ...leave, notes: e.target.value })} /></Field>
        </fieldset>}
      </Modal>
    </div>
  )
}
