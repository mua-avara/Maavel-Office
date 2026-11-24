import { useEffect, useRef, useState } from 'react'
import { useData } from '../data/DataContext'
import { fileSize, fileUrl, openFile, removeFile, uploadFile } from '../lib/files'
import { niceDate } from '../lib/format'
import type { FileRow, OwnerType } from '../lib/types'
import { ConfirmDelete } from './ui'

/**
 * Scans and photos attached to a record. With one kind it is a compact row
 * (e.g. "E-visa" on a staff profile); with several it shows a kind picker.
 */
export default function Files({ ownerType, ownerId, kinds, compact, empty = 'No files yet.' }: {
  ownerType: OwnerType; ownerId: string; kinds: readonly string[]; compact?: boolean; empty?: string
}) {
  const d = useData()
  const input = useRef<HTMLInputElement>(null)
  const [kind, setKind] = useState(kinds[0])
  const [busy, setBusy] = useState('')

  if (d.missing.includes('files')) return compact ? null : <p className="note">File uploads need the latest database update. Run the newest section of <code>supabase/schema.sql</code> in Supabase.</p>

  const list = d.files
    .filter(f => f.owner_type === ownerType && f.owner_id === ownerId && kinds.includes(f.kind))
    .sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind) || b.created_at.localeCompare(a.created_at))

  async function picked(files: FileList | null) {
    if (!files?.length) return
    for (const [i, file] of [...files].entries()) {
      setBusy(files.length > 1 ? `Uploading ${i + 1} of ${files.length}…` : 'Uploading…')
      const err = await uploadFile(ownerType, ownerId, kind, file)
      if (err) { d.toast(err); break }
    }
    setBusy('')
    if (input.current) input.current.value = ''
    await d.reload('files')
    d.toast('Uploaded')
  }

  async function view(f: FileRow, download = false) {
    if (!(await openFile(f, download))) d.toast('Couldn’t open the file. Try again.')
  }

  async function del(f: FileRow) {
    const err = await removeFile(f)
    if (err) { d.toast(err); return }
    await d.reload('files')
    d.toast('File deleted')
  }

  return (
    <div className={`files${compact ? ' compact' : ''}`}>
      {list.length > 0 ? (
        <ul>
          {list.map(f => (
            <li key={f.id}>
              <button type="button" className="link plain fname" onClick={() => view(f)} title="Open">
                <span className="ficon" aria-hidden>{f.mime === 'application/pdf' ? 'PDF' : 'IMG'}</span>
                <span>{!compact && kinds.length > 1 && <b>{f.kind}: </b>}{f.name}<span className="sub">{fileSize(f.size)} · {niceDate(f.created_at.slice(0, 10))}</span></span>
              </button>
              <span className="factions">
                <button type="button" className="small" onClick={() => view(f, true)}>Download</button>
                {d.canEdit && <ConfirmDelete onConfirm={() => del(f)} />}
              </span>
            </li>
          ))}
        </ul>
      ) : !compact && <p className="note">{empty}</p>}
      {d.canEdit && (
        <div className="fupload">
          {kinds.length > 1 && (
            <select aria-label="Type of file" value={kind} onChange={e => setKind(e.target.value)}>
              {kinds.map(k => <option key={k}>{k}</option>)}
            </select>
          )}
          <button type="button" className="small" disabled={!!busy} onClick={() => input.current?.click()}>
            {busy || (compact ? `+ Upload ${kinds[0].toLowerCase()}` : '+ Upload file')}
          </button>
          <input ref={input} type="file" hidden multiple={!compact} accept="image/*,application/pdf" onChange={e => picked(e.target.files)} />
        </div>
      )}
    </div>
  )
}

/** The latest photo of a given kind (e.g. passport photo), or initials. */
export function Photo({ ownerType, ownerId, kind, name }: { ownerType: OwnerType; ownerId: string; kind: string; name: string }) {
  const d = useData()
  const f = d.files
    .filter(x => x.owner_type === ownerType && x.owner_id === ownerId && x.kind === kind && x.mime.startsWith('image/'))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
  const [src, setSrc] = useState<{ path: string; url: string } | null>(null)
  const path = f?.path
  useEffect(() => {
    if (!path) return
    let alive = true
    fileUrl({ path, name: '' }).then(url => { if (alive && url) setSrc({ path, url }) })
    return () => { alive = false }
  }, [path])
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('')
  return f && src?.path === f.path
    ? <img className="avatar" src={src.url} alt={`${name} photo`} />
    : <span className="avatar" aria-hidden>{initials || '?'}</span>
}
