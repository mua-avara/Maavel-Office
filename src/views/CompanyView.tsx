import { useMemo, useState } from 'react'
import { useData } from '../data/DataContext'
import { expiryLevel, LEVEL_PILL } from '../lib/dashboard'
import { fmt0, niceDate } from '../lib/format'
import { COMPANY_FILE_KINDS, DOC_CATEGORIES, type CompanyDoc } from '../lib/types'
import { removeAllFiles } from '../lib/files'
import { ConfirmDelete, Empty, Field, Modal, Pill, Section, Tile } from '../components/ui'
import { SetupNote } from './DashboardView'
import Files from '../components/Files'

const blank = (): CompanyDoc => ({ id: '', name: '', category: 'Registration & licence', number: '', issuer: '', issue_date: null, expiry_date: null, renewal_cost: null, notes: '' })

/** Common Maldives company papers, offered as one-tap starters when the list is empty. */
const STARTERS: Pick<CompanyDoc, 'name' | 'category' | 'issuer'>[] = [
  { name: 'Company registration', category: 'Registration & licence', issuer: 'Ministry of Economic Development' },
  { name: 'Business permit / trade licence', category: 'Registration & licence', issuer: 'Ministry of Economic Development' },
  { name: 'SME registration', category: 'Registration & licence', issuer: 'Ministry of Economic Development' },
  { name: 'Construction industry registration', category: 'Registration & licence', issuer: 'Ministry of Construction' },
  { name: 'GST registration', category: 'Tax (MIRA)', issuer: 'MIRA' },
  { name: 'Expat quota approval', category: 'Expat quota', issuer: 'Ministry of Homeland Security (Xpat)' },
]

export default function CompanyView() {
  const d = useData()
  const [edit, setEdit] = useState<CompanyDoc | null>(null)
  const [q, setQ] = useState('')

  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    return d.company_docs
      .filter(c => !t || [c.name, c.category, c.number, c.issuer, c.notes].join(' ').toLowerCase().includes(t))
      .map(c => ({ c, e: expiryLevel(c.expiry_date) }))
      .sort((a, b) => (a.c.expiry_date ?? '9999').localeCompare(b.c.expiry_date ?? '9999') || a.c.name.localeCompare(b.c.name))
  }, [d.company_docs, q])

  const filesFor = (id: string) => { const n = d.files.filter(f => f.owner_type === 'company_doc' && f.owner_id === id).length; return n ? `${n} file${n === 1 ? '' : 's'}` : '' }

  if (d.missing.includes('company_docs')) return <div className="view"><Section title="Company licences and documents"><SetupNote /></Section></div>

  const all = d.company_docs.map(c => expiryLevel(c.expiry_date))
  const urgent = all.filter(e => e.level === 'bad').length
  const soon = all.filter(e => e.level === 'warn').length
  const cost = d.company_docs.filter(c => { const e = expiryLevel(c.expiry_date); return e.days != null && e.days <= 90 }).reduce((a, c) => a + Number(c.renewal_cost || 0), 0)

  async function save() {
    if (!edit) return
    const { id, ...rest } = edit
    const row = { ...rest, name: rest.name.trim(), issue_date: rest.issue_date || null, expiry_date: rest.expiry_date || null, ...(id ? { id } : {}) }
    if (!row.name) { d.toast('Give the document a name.'); return }
    if (await d.upsert('company_docs', row)) { setEdit(null); d.toast('Saved') }
  }

  return (
    <div className="view">
      <div className="tiles">
        <Tile label="Documents on file" value={d.company_docs.length} sub="Licences, permits, leases" />
        <Tile label="Expired or within 30 days" value={urgent} sub="Renew now" />
        <Tile label="Due in 31–60 days" value={soon} sub="Plan the renewal" />
        <Tile label="Renewal fees, next 90 days" value={fmt0(cost)} sub="MVR, where a fee is entered" total />
      </div>
      <Section title="Company licences and documents" intro="Business registration, permits, GST, leases, insurance, vehicles, quota approvals. Add the expiry date and Maavel will warn you 60 days before."
        action={<button className="primary" disabled={!d.canEdit} onClick={() => setEdit(blank())}>Add document</button>}>
        {d.company_docs.length > 0 && <div className="toolbar"><Field label="Search"><input value={q} placeholder="Name, number or issuer" onChange={e => setQ(e.target.value)} /></Field></div>}
        <div className="tablewrap"><table>
          <thead><tr><th>Document</th><th>Expires</th><th>Status</th><th className="num hide-sm">Renewal fee</th></tr></thead>
          <tbody>
            {!list.length ? <Empty cols={4}>{d.company_docs.length ? 'Nothing matches.' : 'No documents yet. Tap Add document, or start from a common one below.'}</Empty>
              : list.map(({ c, e }) => (
                <tr key={c.id} className="clickable" onClick={() => setEdit(c)}>
                  <td><button className="link plain" onClick={ev => { ev.stopPropagation(); setEdit(c) }}>{c.name}</button>
                    <span className="sub">{[c.category, c.number, c.issuer, filesFor(c.id)].filter(Boolean).join(' · ')}</span></td>
                  <td className="nowrap">{c.expiry_date ? niceDate(c.expiry_date) : 'Does not expire'}</td>
                  <td>{c.expiry_date ? <Pill kind={LEVEL_PILL[e.level]}>{e.level === 'ok' ? 'OK' : e.text}</Pill> : <span className="sub">–</span>}</td>
                  <td className="num hide-sm">{c.renewal_cost ? fmt0(c.renewal_cost) : '–'}</td>
                </tr>
              ))}
          </tbody>
        </table></div>
        {!d.company_docs.length && d.canEdit && (
          <div className="chips">
            {STARTERS.map(s => <button key={s.name} type="button" className="small" onClick={() => setEdit({ ...blank(), ...s })}>+ {s.name}</button>)}
          </div>
        )}
      </Section>

      <Modal wide open={!!edit} title={edit?.id ? 'Edit document' : 'New document'} onClose={() => setEdit(null)} onSubmit={save}
        footer={edit?.id ? <ConfirmDelete onConfirm={async () => { await removeAllFiles(d.files, 'company_doc', edit.id); if (await d.remove('company_docs', edit.id)) { setEdit(null); d.reload('files'); d.toast('Deleted') } }} /> : undefined}>
        {edit && <fieldset disabled={!d.canEdit}>
          <Field label="Document"><input required value={edit.name} placeholder="e.g. Business permit" onChange={e => setEdit({ ...edit, name: e.target.value })} /></Field>
          <div className="grid2">
            <Field label="Type"><select value={edit.category} onChange={e => setEdit({ ...edit, category: e.target.value })}>
              {DOC_CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select></Field>
            <Field label="Number"><input value={edit.number} onChange={e => setEdit({ ...edit, number: e.target.value })} /></Field>
            <Field label="Issued by"><input value={edit.issuer} placeholder="e.g. MIRA" onChange={e => setEdit({ ...edit, issuer: e.target.value })} /></Field>
            <Field label="Renewal fee (MVR)"><input type="number" min="0" inputMode="decimal" value={edit.renewal_cost ?? ''} onChange={e => setEdit({ ...edit, renewal_cost: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
            <Field label="Issue date"><input type="date" value={edit.issue_date ?? ''} onChange={e => setEdit({ ...edit, issue_date: e.target.value || null })} /></Field>
            <Field label="Expiry date (blank if it never expires)"><input type="date" value={edit.expiry_date ?? ''} onChange={e => setEdit({ ...edit, expiry_date: e.target.value || null })} /></Field>
          </div>
          <Field label="Notes"><input value={edit.notes} placeholder="Where the original is kept, who renews it…" onChange={e => setEdit({ ...edit, notes: e.target.value })} /></Field>
        </fieldset>}
        {edit && (edit.id
          ? <fieldset className="box"><legend>Scans and copies</legend><Files ownerType="company_doc" ownerId={edit.id} kinds={COMPANY_FILE_KINDS} empty="No scans yet. Upload a photo or PDF of the certificate." /></fieldset>
          : <p className="note">Save the document first, then open it again to upload a scan.</p>)}
      </Modal>
    </div>
  )
}
