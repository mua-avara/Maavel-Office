import { useEffect, useRef, useState } from 'react'
import { useData } from '../data/DataContext'
import { fileSize, fileUrl, openFile, removeFile, shareFile, uploadFile, type PendingFile } from '../lib/files'
import { niceDate } from '../lib/format'
import type { FileRow, OwnerType } from '../lib/types'
import { ConfirmDelete } from './ui'

/**
 * Scans and photos attached to a record. With one kind it is a compact row
 * (e.g. "E-visa" on a staff profile); with several it shows a kind picker.
 * On a form for a new record, pass `queue`/`onQueue`: files are held until the record is saved.
 */
export default function Files({ ownerType, ownerId, kinds, compact, empty = 'No files yet.', queue, onQueue }: {
  ownerType: OwnerType; ownerId: string; kinds: readonly string[]; compact?: boolean; empty?: string
  queue?: PendingFile[]; onQueue?: (q: PendingFile[]) => void
}) {
  const d = useData()
  const input = useRef<HTMLInputElement>(null)
  const [kind, setKind] = useState(kinds[0])
  const [busy, setBusy] = useState('')

  if (d.missing.includes('files')) return compact ? null : <p className="note">File uploads need the latest database update. Run the newest section of <code>supabase/schema.sql</code> in Supabase.</p>

  const list = d.files
    .filter(f => f.owner_type === ownerType && f.owner_id === ownerId && kinds.includes(f.kind))
    .sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind) || b.created_at.localeCompare(a.created_at))

  const draft = !!onQueue

  async function picked(files: FileList | null) {
    if (!files?.length) return
    if (draft) {
      onQueue!([...(queue ?? []), ...[...files].map(file => ({ kind, file }))])
      if (input.current) input.current.value = ''
      return
    }
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

  async function share(f: FileRow) {
    const r = await shareFile(f)
    if (r === 'copied') d.toast('Link copied. Paste it in WhatsApp or email; it works for 7 days.')
    else if (r === 'failed') d.toast('Couldn’t share the file. Try Download instead.')
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
                <button type="button" className="small" onClick={() => share(f)}>Share</button>
                {d.canEdit && <ConfirmDelete onConfirm={() => del(f)} />}
              </span>
            </li>
          ))}
        </ul>
      ) : !compact && !queue?.length && <p className="note">{empty}</p>}
      {draft && !!queue?.length && (
        <ul>
          {queue.map((p, i) => (
            <li key={`${p.file.name}-${i}`} className="pending">
              <span className="fname">
                <span className="ficon" aria-hidden>{p.file.type === 'application/pdf' ? 'PDF' : 'IMG'}</span>
                <span>{kinds.length > 1 && <b>{p.kind}: </b>}{p.file.name}<span className="sub">{fileSize(p.file.size)} · uploads when you save</span></span>
              </span>
              <span className="factions"><button type="button" className="small" onClick={() => onQueue!(queue.filter((_, j) => j !== i))}>Remove</button></span>
            </li>
          ))}
        </ul>
      )}
      {d.canEdit && (
        <div className="fupload">
          {kinds.length > 1 && (
            <select aria-label="Type of file" value={kind} onChange={e => setKind(e.target.value)}>
              {kinds.map(k => <option key={k}>{k}</option>)}
            </select>
          )}
          <button type="button" className="small" disabled={!!busy} onClick={() => input.current?.click()}>
            {busy || (compact ? `+ Upload ${kinds[0].toLowerCase()}` : draft ? '+ Add file' : '+ Upload file')}
          </button>
          <input ref={input} type="file" hidden multiple={!compact || draft} accept="image/*,application/pdf" onChange={e => picked(e.target.files)} />
        </div>
      )}
    </div>
  )
}

/** The person's photo: latest "Profile photo", else latest "Passport photo", else initials. */
export function Photo({ ownerType, ownerId, kinds = ['Profile photo', 'Passport photo'], name, small }: {
  ownerType: OwnerType; ownerId: string; kinds?: string[]; name: string; small?: boolean
}) {
  const d = useData()
  const mine = d.files.filter(x => x.owner_type === ownerType && x.owner_id === ownerId && x.mime.startsWith('image/') && kinds.includes(x.kind))
  const f = kinds.map(k => mine.filter(x => x.kind === k).sort((a, b) => b.created_at.localeCompare(a.created_at))[0]).find(Boolean)
  const [src, setSrc] = useState<{ path: string; url: string } | null>(null)
  const path = f?.path
  useEffect(() => {
    if (!path) return
    let alive = true
    fileUrl({ path, name: '' }).then(url => { if (alive && url) setSrc({ path, url }) })
    return () => { alive = false }
  }, [path])
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('')
  const cls = `avatar${small ? ' sm' : ''}`
  return f && src?.path === f.path
    ? <img className={cls} src={src.url} alt="" loading="lazy" />
    : <span className={cls} aria-hidden>{initials || '?'}</span>
}

/** The profile photo with a "change photo" control for editors. */
export function EditablePhoto({ ownerId, name, ownerType = 'staff', kind = 'Profile photo', kinds }: { ownerId: string; name: string; ownerType?: OwnerType; kind?: string; kinds?: string[] }) {
  const d = useData()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  if (!d.canEdit || d.missing.includes('files')) return <Photo ownerType={ownerType} ownerId={ownerId} name={name} kinds={kinds} />
  async function picked(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith('image/')) { d.toast('Choose a photo (JPG or PNG).'); return }
    setBusy(true)
    const err = await uploadFile(ownerType, ownerId, kind, file)
    await d.reload('files')
    setBusy(false)
    if (input.current) input.current.value = ''
    d.toast(err ?? 'Photo updated')
  }
  return (
    <>
      <button type="button" className={`photo-edit${busy ? ' busy' : ''}`} onClick={() => input.current?.click()} aria-label={`Change profile photo for ${name}`} title="Change photo">
        <Photo ownerType={ownerType} ownerId={ownerId} name={name} kinds={kinds} />
        <span className="photo-cam" aria-hidden>{busy ? 'Uploading…' : 'Change'}</span>
      </button>
      <input ref={input} type="file" hidden accept="image/*" onChange={e => picked(e.target.files?.[0])} />
    </>
  )
}
