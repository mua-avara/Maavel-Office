import { useRef, useState } from 'react'
import { useData } from '../data/DataContext'
import { scanDocument, type ScanFields, type ScanType } from '../lib/scan'
import { Icon } from './icons'

/**
 * "Scan to fill": pick or photograph a document, let it be read, and hand the fields
 * (and the file, so it can be attached on save) back to the form. Nothing is saved here.
 */
export default function ScanToFill({ options, onResult }: {
  options: { type: ScanType; label: string }[]
  onResult: (type: ScanType, fields: ScanFields, file: File) => number
}) {
  const d = useData()
  const input = useRef<HTMLInputElement>(null)
  const [type, setType] = useState<ScanType>(options[0].type)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  if (!d.canEdit) return null

  async function picked(file: File | undefined) {
    if (input.current) input.current.value = ''
    if (!file) return
    setBusy(true); setMsg(null)
    const r = await scanDocument(type, file)
    setBusy(false)
    if (!r.ok) { setMsg({ ok: false, text: r.error }); return }
    const filled = onResult(type, r.fields, file)
    setMsg(filled
      ? { ok: true, text: `Filled ${filled} field${filled === 1 ? '' : 's'} from the ${options.find(o => o.type === type)?.label.toLowerCase()}. Check the highlighted fields, then Save. The file will be attached.` }
      : { ok: false, text: 'Nothing could be read from that file. Try a sharper, straight-on photo with no glare.' })
  }

  return (
    <div className="scanbar">
      <div className="scanrow">
        <Icon name="scan" size={18} />
        <span className="scantitle">Scan a document to fill this form</span>
        {options.length > 1 && (
          <select aria-label="Which document" value={type} disabled={busy} onChange={e => setType(e.target.value as ScanType)}>
            {options.map(o => <option key={o.type} value={o.type}>{o.label}</option>)}
          </select>
        )}
        <button type="button" className="small primary" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? 'Reading…' : options.length > 1 ? 'Scan' : `Scan ${options[0].label.toLowerCase()}`}
        </button>
        <input ref={input} type="file" hidden accept="image/*,application/pdf" onChange={e => picked(e.target.files?.[0])} />
      </div>
      {busy && <p className="note">Reading the document… this takes a few seconds.</p>}
      {msg && <p className={`note ${msg.ok ? 'scan-ok' : 'scan-err'}`} role="status">{msg.text}</p>}
    </div>
  )
}
