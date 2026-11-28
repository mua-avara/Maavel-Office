import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useData } from '../data/DataContext'
import { assetDocs, checkLabel, isVessel, worstExpiry } from '../lib/assets'
import { LEVEL_PILL } from '../lib/dashboard'
import { removeAllFiles, uploadPending, type PendingFile } from '../lib/files'
import { fmt0, niceDate, num } from '../lib/format'
import { ASSET_FILE_KINDS, ASSET_STATUSES, MACHINE_TYPES, VEHICLE_TYPES, type Asset, type AssetKind, type AssetStatus } from '../lib/types'
import { ConfirmDelete, Empty, Field, Modal, Pill, Section, Tile } from '../components/ui'
import Files, { EditablePhoto, Photo } from '../components/Files'
import ScanToFill from '../components/Scan'
import { isoDate, str as txt, type ScanFields, type ScanType } from '../lib/scan'

type Show = 'all' | AssetKind
const STATUS_PILL: Record<AssetStatus, string> = { 'In use': 'paid', Idle: 'upcoming', 'Under repair': 'soon', Sold: 'left' }

const blank = (kind: AssetKind): Asset => ({
  id: '', kind, type: kind === 'vehicle' ? 'Pickup' : 'Excavator', name: '', reg_no: '', make: '', model: '', year: null, colour: '',
  chassis_no: '', engine_no: '', serial_no: '', registered_owner: 'Maavel Maldives Pvt Ltd', status: 'In use', project_id: null,
  purchase_date: null, purchase_price: null, annual_fee_due: null, annual_fee: null, insurance_exp: null, insurance_provider: '',
  policy_no: '', roadworthy_exp: null, notes: '',
})

export default function AssetsView({ id }: { id: string | null }) {
  const d = useData()
  const [edit, setEdit] = useState<Asset | null>(null)
  const [show, setShow] = useState<Show>('all')
  const [q, setQ] = useState('')

  // "#assets/new-vehicle" and "#assets/new-machine" open the add form once.
  const [handled, setHandled] = useState<string | null>(null)
  if (id !== handled) {
    setHandled(id)
    if (d.canEdit && id === 'new-vehicle') setEdit(blank('vehicle'))
    if (d.canEdit && id === 'new-machine') setEdit(blank('machinery'))
  }
  useEffect(() => { if (id === 'new-vehicle' || id === 'new-machine') history.replaceState(null, '', '#assets') }, [id])

  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    return d.assets
      .filter(a => show === 'all' || a.kind === show)
      .filter(a => !t || [a.name, a.reg_no, a.type, a.make, a.model, a.chassis_no, a.serial_no].join(' ').toLowerCase().includes(t))
      .sort((a, b) => Number(a.status === 'Sold') - Number(b.status === 'Sold') || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
  }, [d.assets, show, q])

  if (d.missing.includes('assets')) return (
    <div className="view"><Section title="Vehicles & equipment"><p className="note">This page needs the latest database update. Run the “Vehicles &amp; equipment register” section of <code>supabase/schema.sql</code> in the Supabase SQL Editor, then reload.</p></Section></div>
  )

  const dialog = <AssetDialog asset={edit} onClose={() => setEdit(null)} />

  const realId = id && !id.startsWith('new-') ? id : null
  if (realId) {
    const a = d.assets.find(x => x.id === realId)
    if (!a) return <div className="view"><Section title="Not found"><p className="note">This vehicle or machine was deleted. <a href="#assets">Back to vehicles &amp; equipment</a></p></Section></div>
    return <AssetPage a={a} onEdit={() => setEdit(a)} dialog={dialog} />
  }

  const live = d.assets.filter(a => a.status !== 'Sold')
  const due = live.flatMap(a => assetDocs(a)).filter(x => x.days != null && x.days <= 60)
  const fees90 = live.filter(a => a.annual_fee_due && (assetDocs(a)[0].days ?? 999) <= 90).reduce((s, a) => s + num(a.annual_fee), 0)
  const projectName = (pid: string | null) => d.projects.find(p => p.id === pid)?.name

  return (
    <div className="view">
      <div className="tiles">
        <Tile label="Vehicles" value={live.filter(a => a.kind === 'vehicle').length} sub="Cars, bikes, boats, site vehicles" />
        <Tile label="Machinery" value={live.filter(a => a.kind === 'machinery').length} sub="Excavators, cranes, mixers…" />
        <Tile label="Papers due in 60 days" value={due.length} sub={`${due.filter(x => x.level === 'bad').length} expired or within 30 days`} />
        <Tile label="Annual fees, next 90 days" value={fmt0(fees90)} sub="MVR, where a fee is entered" total />
      </div>

      <Section title="Vehicles & equipment" intro="Registry details, annual fee, insurance and road worthiness for every vehicle and machine. Maavel warns you 60 days before anything expires."
        action={d.canEdit ? <div className="head-actions"><button className="primary" onClick={() => setEdit(blank('vehicle'))}>Add vehicle</button><button onClick={() => setEdit(blank('machinery'))}>Add machinery</button></div> : undefined}>
        {d.assets.length > 0 && (
          <div className="toolbar">
            <Field label="Search"><input value={q} placeholder="Name, registration, chassis or serial no." onChange={e => setQ(e.target.value)} /></Field>
            <Field label="Show"><select value={show} onChange={e => setShow(e.target.value as Show)}>
              <option value="all">Vehicles and machinery</option><option value="vehicle">Vehicles</option><option value="machinery">Machinery</option>
            </select></Field>
          </div>
        )}
        <div className="tablewrap"><table>
          <thead><tr><th>Vehicle / machine</th><th>Next renewal</th><th className="hide-sm">Type</th><th className="hide-sm">Site</th></tr></thead>
          <tbody>
            {!list.length ? <Empty cols={4}>{d.assets.length ? 'Nothing matches.' : 'Nothing added yet. Tap Add vehicle or Add machinery.'}</Empty> : list.map(a => {
              const w = worstExpiry(a)
              return (
                <tr key={a.id} className={`clickable${a.status === 'Sold' ? ' inactive' : ''}`} onClick={() => { location.hash = `assets/${a.id}` }}>
                  <td className="name"><div className="who-row"><Photo ownerType="asset" ownerId={a.id} name={a.name} kinds={['Photo']} small /><div>
                    <a className="link plain" href={`#assets/${a.id}`} onClick={e => e.stopPropagation()}>{a.name}</a>
                    <span className="sub">{[a.reg_no, a.status !== 'In use' ? a.status.toLowerCase() : ''].filter(Boolean).join(' · ') || (a.kind === 'vehicle' ? 'No registration no.' : a.serial_no || '–')}</span>
                  </div></div></td>
                  <td>{a.status === 'Sold' ? <Pill kind="left">Sold</Pill> : w ? <Pill kind={LEVEL_PILL[w.level]}>{w.level === 'ok' ? 'OK' : `${w.label}: ${w.text}`}</Pill> : <span className="sub">Add dates</span>}</td>
                  <td className="hide-sm cat">{a.type}</td>
                  <td className="hide-sm">{projectName(a.project_id) ?? <span className="sub">–</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table></div>
      </Section>
      {dialog}
    </div>
  )
}

function AssetPage({ a, onEdit, dialog }: { a: Asset; onEdit: () => void; dialog: ReactNode }) {
  const d = useData()
  const project = d.projects.find(p => p.id === a.project_id)
  const docs = assetDocs(a)
  const facts: [string, string | null | undefined][] = [
    ['Registration no.', a.reg_no], ['Make', a.make], ['Model', a.model], ['Year', a.year ? String(a.year) : ''], ['Colour', a.colour],
    ['Chassis / hull no.', a.chassis_no], ['Engine no.', a.engine_no], ['Serial no.', a.serial_no], ['Registered owner', a.registered_owner],
    ['Purchased', a.purchase_date ? niceDate(a.purchase_date) : ''], ['Purchase price', a.purchase_price ? `MVR ${fmt0(a.purchase_price)}` : ''],
  ]
  const shown = facts.filter(([, v]) => v)
  return (
    <div className="view">
      <p className="crumbs"><a href="#assets">‹ All vehicles &amp; equipment</a></p>
      <section className="profile-head">
        <EditablePhoto ownerType="asset" ownerId={a.id} name={a.name} kind="Photo" kinds={['Photo']} />
        <div className="grow">
          <h2>{a.name}</h2>
          <p>{[a.reg_no, a.type, a.kind === 'vehicle' ? (isVessel(a) ? 'Vessel' : 'Vehicle') : 'Machinery'].filter(Boolean).join(' · ')}</p>
          <p className="pills">
            <Pill kind={STATUS_PILL[a.status]}>{a.status}</Pill>
            {project && <a className="pill upcoming" href={`#projects/${project.id}`}>{project.name}</a>}
          </p>
        </div>
        <div className="head-actions"><button className="primary" disabled={!d.canEdit} onClick={onEdit}>Edit details</button></div>
      </section>

      <div className="cols">
        <Section title="Registry details">
          {!shown.length ? <p className="empty">No details yet. Tap Edit details to add the registration, chassis and engine numbers.</p> : (
            <dl className="facts">{shown.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
          )}
          {a.notes && <p className="note">{a.notes}</p>}
        </Section>

        <Section title="Renewals" intro="Dates warn 60 days ahead.">
          <ul className="docrows">
            {docs.map(r => (
              <li key={r.key}>
                <div className="dochead">
                  <b>{r.label}</b>
                  <span className="sub">{[
                    r.date ? `due ${niceDate(r.date)}` : 'no date yet',
                    r.key === 'annual_fee_due' && a.annual_fee ? `MVR ${fmt0(a.annual_fee)}` : '',
                    r.key === 'insurance_exp' ? [a.insurance_provider, a.policy_no].filter(Boolean).join(' ') : '',
                  ].filter(Boolean).join(' · ')}</span>
                  {r.date && a.status !== 'Sold' && <Pill kind={LEVEL_PILL[r.level]}>{r.level === 'ok' ? 'OK' : r.text}</Pill>}
                </div>
                <Files ownerType="asset" ownerId={a.id} kinds={[r.fileKind]} compact />
              </li>
            ))}
          </ul>
          <h3 className="mini">Registration and other papers</h3>
          <Files ownerType="asset" ownerId={a.id} kinds={['Registration', 'Other']} empty="Registration card, purchase papers, manuals…" />
        </Section>
      </div>
      {dialog}
    </div>
  )
}

function AssetDialog({ asset, onClose }: { asset: Asset | null; onClose: () => void }) {
  const d = useData()
  const [f, setF] = useState<Asset | null>(null)
  const [key, setKey] = useState<Asset | null>(null)
  const [queue, setQueue] = useState<PendingFile[]>([])
  const [hl, setHl] = useState<Set<string>>(new Set())
  if (asset !== key) { setKey(asset); setF(asset); setQueue([]); setHl(new Set()) }
  const set = <K extends keyof Asset>(k: K, v: Asset[K]) => setF(cur => (cur ? { ...cur, [k]: v } : cur))
  const str = (k: keyof Asset) => (e: { target: { value: string } }) => set(k, e.target.value as never)
  const date = (k: keyof Asset) => (e: { target: { value: string } }) => set(k, (e.target.value || null) as never)
  const numv = (k: keyof Asset) => (e: { target: { value: string } }) => set(k, (e.target.value === '' ? null : Number(e.target.value)) as never)

  // A scanned registration card, insurance, certificate or fee receipt fills the matching fields.
  function scanned(type: ScanType, x: ScanFields, file: File) {
    if (!f) return 0
    const next: Partial<Asset> = {}
    const put = <K extends keyof Asset>(k: K, v: Asset[K] | null | undefined, onlyIfEmpty = false) => { if (v != null && v !== '' && !(onlyIfEmpty && f[k])) next[k] = v as Asset[K] }
    const reg = txt(x.reg_no)?.toUpperCase()
    if (type === 'vehicle_registration') {
      put('reg_no', reg); put('make', txt(x.make)); put('model', txt(x.model))
      put('year', typeof x.year === 'number' ? Math.round(x.year) : null); put('colour', txt(x.colour))
      put('chassis_no', txt(x.chassis_no)); put('engine_no', txt(x.engine_no)); put('registered_owner', txt(x.registered_owner))
      put('name', [txt(x.make), txt(x.model)].filter(Boolean).join(' ') || null, true)
    } else if (type === 'insurance') {
      put('insurance_exp', isoDate(x.expiry_date)); put('insurance_provider', txt(x.insurer)); put('policy_no', txt(x.policy_no)); put('reg_no', reg, true)
    } else if (type === 'road_worthiness') {
      put('roadworthy_exp', isoDate(x.expiry_date)); put('reg_no', reg, true)
    } else if (type === 'annual_fee') {
      put('annual_fee_due', isoDate(x.next_due_date)); put('annual_fee', typeof x.amount_mvr === 'number' ? x.amount_mvr : null); put('reg_no', reg, true)
    }
    const keys = Object.keys(next)
    if (keys.length) {
      setF(cur => (cur ? { ...cur, ...next } : cur))
      setHl(cur => new Set([...cur, ...keys]))
      const kind = type === 'vehicle_registration' ? 'Registration' : type === 'insurance' ? 'Insurance' : type === 'road_worthiness' ? 'Road worthiness' : 'Annual fee receipt'
      setQueue(q => [...q, { kind, file }])
    }
    return keys.length
  }

  async function save() {
    if (!f) return
    if (!f.name.trim()) { d.toast(`Give the ${f.kind === 'vehicle' ? 'vehicle' : 'machine'} a name, e.g. “Toyota Hilux”.`); return }
    const assetId = f.id || crypto.randomUUID()
    const row: Asset = { ...f, id: assetId, name: f.name.trim(), reg_no: f.reg_no.trim().toUpperCase() }
    if (!(await d.upsert('assets', row))) return
    let msg = 'Saved'
    if (queue.length) {
      const r = await uploadPending('asset', assetId, queue)
      await d.reload('files')
      msg = r.failed ? `Saved, but ${r.failed} file${r.failed === 1 ? '' : 's'} didn’t upload: ${r.reason}` : `Saved with ${queue.length} file${queue.length === 1 ? '' : 's'}`
    }
    setQueue([]); onClose(); d.toast(msg)
    if (!f.id) location.hash = `assets/${assetId}`
  }

  async function del() {
    if (!f?.id) return
    await removeAllFiles(d.files, 'asset', f.id)
    if (await d.remove('assets', f.id)) { onClose(); d.reload('files'); location.hash = 'assets'; d.toast('Deleted') }
  }

  const vehicle = f?.kind === 'vehicle'
  const types: readonly string[] = vehicle ? VEHICLE_TYPES : MACHINE_TYPES
  return (
    <Modal wide open={!!f} title={f?.id ? `Edit ${f.name}` : vehicle ? 'Add vehicle' : 'Add machinery'} onClose={onClose} onSubmit={save}
      footer={f?.id ? <ConfirmDelete onConfirm={del} /> : undefined}>
      {f && <fieldset disabled={!d.canEdit}>
        <ScanToFill options={[
          { type: 'vehicle_registration', label: 'Registration card' },
          { type: 'insurance', label: 'Insurance' },
          { type: 'road_worthiness', label: checkLabel(f).split(' / ')[0] },
          { type: 'annual_fee', label: 'Annual fee receipt' },
        ]} onResult={scanned} />
        <div className="grid2">
          <Field label={vehicle ? 'Vehicle name' : 'Machine name'} hl={hl.has('name')}><input required value={f.name} placeholder={vehicle ? 'e.g. Toyota Hilux' : 'e.g. CAT 320 excavator'} onChange={str('name')} /></Field>
          <Field label="Type"><select value={types.includes(f.type) ? f.type : 'Other'} onChange={str('type')}>{types.map(t => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Status"><select value={f.status} onChange={e => set('status', e.target.value as AssetStatus)}>{ASSET_STATUSES.map(s => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Site / project"><select value={f.project_id ?? ''} onChange={e => set('project_id', e.target.value || null)}>
            <option value="">Not on a site (office / yard)</option>
            {d.projects.filter(p => p.status !== 'Completed' || p.id === f.project_id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></Field>
        </div>

        <fieldset className="box"><legend>Registry</legend>
          <div className="grid2">
            <Field label={isVessel(f) ? 'Vessel registration no.' : vehicle ? 'Registration (number plate)' : 'Registration no. (if any)'} hl={hl.has('reg_no')}><input value={f.reg_no} placeholder={isVessel(f) ? 'e.g. A1234A' : 'e.g. P-1234'} onChange={str('reg_no')} /></Field>
            <Field label="Registered owner" hl={hl.has('registered_owner')}><input value={f.registered_owner} onChange={str('registered_owner')} /></Field>
            <Field label="Make" hl={hl.has('make')}><input value={f.make} placeholder="e.g. Toyota, CAT, Yamaha" onChange={str('make')} /></Field>
            <Field label="Model" hl={hl.has('model')}><input value={f.model} onChange={str('model')} /></Field>
            <Field label="Year" hl={hl.has('year')}><input type="number" inputMode="numeric" min="1950" max="2100" value={f.year ?? ''} onChange={numv('year')} /></Field>
            <Field label="Colour" hl={hl.has('colour')}><input value={f.colour} onChange={str('colour')} /></Field>
            <Field label={isVessel(f) ? 'Hull no.' : 'Chassis no.'} hl={hl.has('chassis_no')}><input value={f.chassis_no} onChange={str('chassis_no')} /></Field>
            <Field label="Engine no." hl={hl.has('engine_no')}><input value={f.engine_no} onChange={str('engine_no')} /></Field>
            {!vehicle && <Field label="Serial no."><input value={f.serial_no} onChange={str('serial_no')} /></Field>}
            <Field label="Purchase date"><input type="date" value={f.purchase_date ?? ''} onChange={date('purchase_date')} /></Field>
            <Field label="Purchase price (MVR)"><input type="number" min="0" inputMode="decimal" value={f.purchase_price ?? ''} onChange={numv('purchase_price')} /></Field>
          </div>
        </fieldset>

        <fieldset className="box"><legend>Renewals</legend>
          <div className="grid2">
            <Field label="Annual fee due" hl={hl.has('annual_fee_due')}><input type="date" value={f.annual_fee_due ?? ''} onChange={date('annual_fee_due')} /></Field>
            <Field label="Annual fee (MVR)" hl={hl.has('annual_fee')}><input type="number" min="0" inputMode="decimal" value={f.annual_fee ?? ''} onChange={numv('annual_fee')} /></Field>
            <Field label="Insurance expires" hl={hl.has('insurance_exp')}><input type="date" value={f.insurance_exp ?? ''} onChange={date('insurance_exp')} /></Field>
            <Field label="Insurer" hl={hl.has('insurance_provider')}><input value={f.insurance_provider} placeholder="e.g. Allied, Amana" onChange={str('insurance_provider')} /></Field>
            <Field label="Policy no." hl={hl.has('policy_no')}><input value={f.policy_no} onChange={str('policy_no')} /></Field>
            <Field label={`${checkLabel(f)} expires`} hl={hl.has('roadworthy_exp')}><input type="date" value={f.roadworthy_exp ?? ''} onChange={date('roadworthy_exp')} /></Field>
          </div>
        </fieldset>

        <Field label="Notes"><input value={f.notes} placeholder="Where it’s kept, who looks after it…" onChange={str('notes')} /></Field>

        {f.id && queue.length > 0 && <p className="note">Will be attached when you save: {queue.map(q => `${q.kind} (${q.file.name})`).join(', ')}</p>}
        {!f.id && <fieldset className="box"><legend>Photos and papers</legend>
          <Files ownerType="asset" ownerId="" kinds={ASSET_FILE_KINDS} queue={queue} onQueue={setQueue} empty="Add a photo, the registration card, insurance or road worthiness certificate now. They upload when you save." />
        </fieldset>}
      </fieldset>}
    </Modal>
  )
}
