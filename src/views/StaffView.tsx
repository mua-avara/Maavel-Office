import { useEffect, useMemo, useState } from 'react'
import { useData } from '../data/DataContext'
import { byOrder, docState, isActive, isLocal } from '../lib/calc'
import { fmt0, niceDate, todayStr } from '../lib/format'
import { EXPAT_FILE_KINDS, LOCAL_FILE_KINDS, type Staff, type StaffStatus } from '../lib/types'
import { ConfirmDelete, Empty, Field, Modal, Pill, Section, Tile } from '../components/ui'
import { removeAllFiles, uploadPending, type PendingFile } from '../lib/files'
import Files, { Photo } from '../components/Files'
import ScanToFill from '../components/Scan'
import { isoDate, str, titleCase, type ScanFields, type ScanType } from '../lib/scan'
import StaffProfile from './StaffProfile'

type Filter = 'Active' | 'docs' | 'Left' | 'all'

export default function StaffView({ id }: { id: string | null }) {
  const d = useData()
  const person = id && id !== 'new' ? d.staff.find(s => s.id === id) : null
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('Active')
  const [edit, setEdit] = useState<Staff | 'new' | null>(null)
  // "#staff/new" (quick action on the Overview) opens the add form once.
  const [handled, setHandled] = useState<string | null>(null)
  if (id !== handled) { setHandled(id); if (id === 'new' && d.canEdit) setEdit('new') }
  useEffect(() => { if (id === 'new') history.replaceState(null, '', '#staff') }, [id])

  const active = d.staff.filter(isActive)
  const expats = active.filter(s => !isLocal(s)).length
  const needDocs = active.filter(s => docState(s).need).length
  const noDates = active.filter(s => !isLocal(s) && !docState(s).hasDates).length

  const list = useMemo(() => {
    let l = [...d.staff]
    if (filter === 'Active') l = l.filter(isActive)
    else if (filter === 'Left') l = l.filter(s => !isActive(s))
    else if (filter === 'docs') l = l.filter(s => isActive(s) && docState(s).need)
    const t = q.trim().toLowerCase()
    if (t) l = l.filter(s => [s.name, s.designation, s.passport_no, s.country].join(' ').toLowerCase().includes(t))
    return l.sort(byOrder)
  }, [d.staff, filter, q])

  if (id && id !== 'new') return person ? <StaffProfile s={person} /> : <div className="view"><Section title="Not found"><p className="note">This person isn’t in the staff list any more. <a href="#staff">Back to staff</a></p></Section></div>

  const open = (s: Staff) => { location.hash = `staff/${s.id}` }
  const files = (s: Staff) => d.files.filter(f => f.owner_type === 'staff' && f.owner_id === s.id).length

  return (
    <div className="view">
      <div className="tiles">
        <Tile label="Active staff" value={active.length} sub={`${expats} expatriate${expats === 1 ? '' : 's'}`} />
        <Tile label="Monthly salaries" value={fmt0(active.reduce((a, s) => a + Number(s.basic), 0))} sub="Basic, MVR" />
        <Tile label="Monthly allowances" value={fmt0(active.reduce((a, s) => a + Number(s.food) + Number(s.allowance), 0))} sub="Food, phone and other" />
        <Tile label="Documents to renew" value={needDocs} sub={noDates ? `${noDates} expats have no dates yet` : 'Expired or due within 60 days'} total />
      </div>
      <Section title="Staff" intro="Tap a person to see their profile: documents and scans, pay history and leave."
        action={<button className="primary" disabled={!d.canEdit} onClick={() => setEdit('new')}>Add staff</button>}>
        <div className="toolbar">
          <Field label="Search"><input value={q} placeholder="Name, job or ID no." onChange={e => setQ(e.target.value)} /></Field>
          <Field label="Show"><select value={filter} onChange={e => setFilter(e.target.value as Filter)}>
            <option value="Active">Active staff</option><option value="docs">Documents to renew</option><option value="Left">Left Maavel</option><option value="all">Everyone</option>
          </select></Field>
        </div>
        <div className="tablewrap"><table>
          <thead><tr><th>Name</th><th>Documents</th><th className="num">Basic</th><th className="num hide-sm">Allowances</th><th className="hide-sm">Country</th></tr></thead>
          <tbody>
            {!list.length ? <Empty cols={5}>Nobody matches.</Empty> : list.map(s => {
              const ds = docState(s)
              return (
                <tr key={s.id} className="clickable" onClick={() => open(s)}>
                  <td className="name"><div className="who-row"><Photo ownerType="staff" ownerId={s.id} name={s.name} small /><div><a className="link plain" href={`#staff/${s.id}`} onClick={e => e.stopPropagation()}>{s.name}</a><span className="sub">{[s.designation, s.status === 'On leave' ? 'on leave' : '', files(s) ? `${files(s)} file${files(s) === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')}</span></div></div></td>
                  <td>{!isActive(s) ? <Pill kind="left">Left{s.left_date ? ` ${niceDate(s.left_date)}` : ''}</Pill> : isLocal(s) ? <span className="sub">Local · {s.passport_no || 'no ID no.'}</span> : <Pill kind={ds.key}>{ds.text}</Pill>}</td>
                  <td className="num">{fmt0(s.basic)}</td>
                  <td className="num hide-sm">{fmt0(Number(s.food) + Number(s.allowance))}</td>
                  <td className="hide-sm cat">{s.country}</td>
                </tr>
              )
            })}
          </tbody>
        </table></div>
      </Section>
      <StaffDialog staff={edit} onClose={() => setEdit(null)} />
    </div>
  )
}

const blank = { origin: '' as '' | 'local' | 'expat', name: '', designation: '', country: '', status: 'Active' as StaffStatus, basic: '', food: '1200', allowance: '0', join_date: '', left_date: '', phone: '', passport_no: '', passport_exp: '', wp_no: '', wp_exp: '', visa_no: '', visa_exp: '', medical_exp: '', insurance_exp: '', notes: '', emergency_contact: '', annual_leave_days: '30', project_id: '' }
type Form = typeof blank

export function StaffDialog({ staff, onClose }: { staff: Staff | 'new' | null; onClose: () => void }) {
  const d = useData()
  const upgraded = !d.missing.includes('projects')
  const [queue, setQueue] = useState<PendingFile[]>([])
  const [hl, setHl] = useState<Set<string>>(new Set())
  const s = staff && staff !== 'new' ? staff : null
  const [f, setF] = useState<Form>(blank)
  const [key, setKey] = useState<typeof staff>(null)
  if (staff !== key) {
    setKey(staff)
    setHl(new Set())
    if (staff) setF(s ? ({ ...blank, ...Object.fromEntries(Object.keys(blank).filter(k => s[k as keyof Staff] != null).map(k => [k, String(s[k as keyof Staff])])), origin: isLocal(s) ? 'local' : s.country.trim() ? 'expat' : '' } as Form) : blank)
  }
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const local = f.origin === 'local'
  // Choosing Local or Expatriate: locals are Maldivian with no food allowance by default; expats get MVR 1,200 food.
  function pickOrigin(o: 'local' | 'expat') {
    setF(cur => ({
      ...cur, origin: o,
      country: o === 'local' ? 'Maldives' : cur.country.trim().toLowerCase() === 'maldives' ? '' : cur.country,
      ...(!s ? { food: o === 'local' ? (cur.food === '1200' ? '0' : cur.food) : (!Number(cur.food) ? '1200' : cur.food) } : {}),
    }))
    const keep: readonly string[] = o === 'local' ? LOCAL_FILE_KINDS : EXPAT_FILE_KINDS
    setQueue(q => q.filter(x => keep.includes(x.kind)))
  }
  const date = (v: string) => (v ? v : null)

  // A scanned passport or e-visa fills the matching fields; the file is attached on save.
  function scanned(type: ScanType, x: ScanFields, file: File) {
    const next: Partial<Form> = {}
    const put = (k: keyof Form, v: string | null, onlyIfEmpty = false) => { if (v && !(onlyIfEmpty && f[k])) next[k] = v as never }
    if (type === 'national_id') {
      put('name', str(x.full_name) && titleCase(str(x.full_name)!), true)
      put('passport_no', str(x.id_no)?.replace(/\s+/g, '').toUpperCase() ?? null)
    } else if (type === 'passport') {
      put('name', str(x.full_name) && titleCase(str(x.full_name)!), true)
      put('passport_no', str(x.passport_no)?.replace(/\s+/g, '') ?? null)
      put('passport_exp', isoDate(x.expiry_date))
      put('country', str(x.nationality) && titleCase(str(x.nationality)!))
    } else if (type === 'evisa') {
      put('visa_no', str(x.visa_no))
      put('visa_exp', isoDate(x.expiry_date))
      put('name', str(x.holder_name) && titleCase(str(x.holder_name)!), true)
      put('passport_no', str(x.passport_no)?.replace(/\s+/g, '') ?? null, true)
    } else if (type === 'medical') {
      put('medical_exp', isoDate(x.expiry_date))
      put('name', str(x.holder_name) && titleCase(str(x.holder_name)!), true)
      put('passport_no', str(x.passport_no)?.replace(/\s+/g, '') ?? null, true)
    } else if (type === 'insurance') {
      put('insurance_exp', isoDate(x.expiry_date))
      put('name', str(x.insured_name) && titleCase(str(x.insured_name)!), true)
    }
    const keys = Object.keys(next)
    if (keys.length) {
      setF(cur => ({ ...cur, ...next }))
      setHl(cur => new Set([...cur, ...keys]))
      const kind = type === 'national_id' ? 'National ID' : type === 'passport' ? 'Passport copy' : type === 'evisa' ? 'E-visa' : type === 'medical' ? 'Medical' : 'Insurance'
      setQueue(q => [...q, { kind, file }])
    }
    return keys.length
  }

  async function save() {
    if (!f.name.trim()) { d.toast('Enter a name.'); return }
    if (!f.origin) { d.toast('Choose Local (Maldivian) or Expatriate.'); return }
    if (!local && f.country.trim().toLowerCase() === 'maldives') { d.toast('Expatriate staff need a country other than the Maldives. Choose Local for Maldivians.'); return }
    const row: Partial<Staff> = {
      name: f.name.trim(), designation: f.designation.trim(), country: local ? 'Maldives' : f.country.trim(), status: f.status,
      basic: Number(f.basic) || 0, food: Number(f.food) || 0, allowance: Number(f.allowance) || 0,
      join_date: date(f.join_date), left_date: f.status === 'Left' ? (f.left_date || todayStr) : date(f.left_date),
      // For locals passport_no holds the national ID number; expat documents and dates are cleared.
      phone: f.phone.trim(), passport_no: f.passport_no.trim(), passport_exp: local ? null : date(f.passport_exp), wp_no: f.wp_no.trim(),
      wp_exp: date(f.wp_exp), visa_exp: local ? null : date(f.visa_exp), medical_exp: local ? null : date(f.medical_exp), insurance_exp: local ? null : date(f.insurance_exp), notes: f.notes.trim(),
      // Columns from the Nov 2026 upgrade, only once that SQL has been run.
      ...(upgraded ? { visa_no: local ? '' : f.visa_no.trim(), emergency_contact: f.emergency_contact.trim(), annual_leave_days: Number(f.annual_leave_days) || 0, project_id: f.project_id || null } : {}),
    }
    if (s) row.id = s.id
    else { row.id = crypto.randomUUID(); row.sort_order = d.staff.reduce((a, x) => Math.max(a, x.sort_order), 0) + 1 }
    if (!(await d.upsert('staff', row))) return
    let msg = 'Saved'
    if (queue.length) {
      const r = await uploadPending('staff', row.id!, queue)
      await d.reload('files')
      msg = r.failed ? `Saved, but ${r.failed} file${r.failed === 1 ? '' : 's'} didn’t upload: ${r.reason}` : `Saved with ${queue.length} file${queue.length === 1 ? '' : 's'}`
    }
    setQueue([]); onClose(); d.toast(msg)
  }

  return (
    <Modal wide open={!!staff} title={s ? s.name : 'Add staff'} onClose={() => { setQueue([]); onClose() }} onSubmit={save}
      footer={s ? <ConfirmDelete onConfirm={async () => { await removeAllFiles(d.files, 'staff', s.id); if (await d.remove('staff', s.id)) { onClose(); d.reload('files'); location.hash = 'staff'; d.toast('Deleted. To keep history, set Status to Left instead.') } }} /> : undefined}>
      <fieldset disabled={!d.canEdit}>
        <div className="originpick">
          <span className="lbl">Staff type</span>
          <div className="seg2" role="radiogroup" aria-label="Staff type" aria-required="true">
            <button type="button" role="radio" aria-checked={f.origin === 'local'} onClick={() => pickOrigin('local')}>Local (Maldivian)</button>
            <button type="button" role="radio" aria-checked={f.origin === 'expat'} onClick={() => pickOrigin('expat')}>Expatriate</button>
          </div>
          {!f.origin && <span className="sub">Choose one to continue.</span>}
        </div>
        {local && <ScanToFill options={[{ type: 'national_id', label: 'National ID card' }]} onResult={scanned} />}
        {f.origin === 'expat' && <ScanToFill options={[
          { type: 'passport', label: 'Passport' },
          ...(upgraded ? [{ type: 'evisa' as const, label: 'E-visa' }] : []),
          { type: 'medical', label: 'Medical' },
          { type: 'insurance', label: 'Insurance' },
        ]} onResult={scanned} />}
        <div className="grid2">
          <Field label="Full name" hl={hl.has('name')}><input required value={f.name} onChange={set('name')} /></Field>
          <Field label="Designation"><input value={f.designation} placeholder="e.g. Mason" onChange={set('designation')} /></Field>
          {local ? <Field label="National ID no." hl={hl.has('passport_no')}><input value={f.passport_no} placeholder="e.g. A123456" autoCapitalize="characters" onChange={set('passport_no')} /></Field>
            : <Field label="Country" hl={hl.has('country')}><input value={f.country} list="countries" placeholder="e.g. Bangladesh" disabled={!f.origin} onChange={set('country')} /></Field>}
          <Field label="Status"><select value={f.status} onChange={set('status')}><option>Active</option><option>On leave</option><option>Left</option></select></Field>
          <Field label="Basic salary (MVR)"><input type="number" min="0" inputMode="decimal" value={f.basic} onChange={set('basic')} /></Field>
          <Field label="Food allowance (MVR)"><input type="number" min="0" inputMode="decimal" value={f.food} onChange={set('food')} /></Field>
          <Field label="Phone / other allowance (MVR)"><input type="number" min="0" inputMode="decimal" value={f.allowance} onChange={set('allowance')} /></Field>
          <Field label="Phone"><input inputMode="tel" value={f.phone} onChange={set('phone')} /></Field>
          <Field label="Joined"><input type="date" value={f.join_date} onChange={set('join_date')} /></Field>
          <Field label="Left on"><input type="date" value={f.left_date} onChange={set('left_date')} /></Field>
          {upgraded && <>
            <Field label="Site / project"><select value={f.project_id} onChange={set('project_id')}>
              <option value="">Not assigned (office)</option>
              {d.projects.filter(p => p.status !== 'Completed' || p.id === f.project_id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></Field>
            <Field label="Annual leave (days a year)"><input type="number" min="0" inputMode="numeric" value={f.annual_leave_days} onChange={set('annual_leave_days')} /></Field>
            <Field label="Emergency contact" wide><input value={f.emergency_contact} placeholder="Name, relation, phone" onChange={set('emergency_contact')} /></Field>
          </>}
        </div>
        {f.origin === 'expat' && <fieldset className="box"><legend>Passport, e-visa, medical and insurance</legend>
          <div className="grid2">
            <Field label="Passport / ID no." hl={hl.has('passport_no')}><input value={f.passport_no} onChange={set('passport_no')} /></Field>
            <Field label="Passport expiry" hl={hl.has('passport_exp')}><input type="date" value={f.passport_exp} onChange={set('passport_exp')} /></Field>
            {upgraded && <Field label="E-visa no." hl={hl.has('visa_no')}><input value={f.visa_no} onChange={set('visa_no')} /></Field>}
            <Field label="E-visa expiry" hl={hl.has('visa_exp')}><input type="date" value={f.visa_exp} onChange={set('visa_exp')} /></Field>
            <Field label="Medical expiry" hl={hl.has('medical_exp')}><input type="date" value={f.medical_exp} onChange={set('medical_exp')} /></Field>
            <Field label="Insurance expiry" hl={hl.has('insurance_exp')}><input type="date" value={f.insurance_exp} onChange={set('insurance_exp')} /></Field>
          </div>
        </fieldset>}
        <Field label="Notes"><input value={f.notes} onChange={set('notes')} /></Field>
        {s && queue.length > 0 && <p className="note">Will be attached when you save: {queue.map(q => `${q.kind} (${q.file.name})`).join(', ')}</p>}
        {!s && f.origin && <fieldset className="box"><legend>{local ? 'National ID' : 'Documents and scans'}</legend>
          <Files ownerType="staff" ownerId="" kinds={local ? LOCAL_FILE_KINDS : EXPAT_FILE_KINDS} queue={queue} onQueue={setQueue}
            empty={local ? 'Add a photo or scan of the national ID card now. It uploads when you save.' : 'Add the passport copy, e-visa, photo or other papers now. They upload when you save.'} />
        </fieldset>}
      </fieldset>
      <datalist id="countries"><option>Bangladesh</option><option>India</option><option>Sri Lanka</option><option>Nepal</option></datalist>
    </Modal>
  )
}
