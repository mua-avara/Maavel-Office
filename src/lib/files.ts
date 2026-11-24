import { supabase } from './supabase'
import type { FileRow, OwnerType } from './types'

const BUCKET = 'files'
const MAX_SIDE = 2000

const safeName = (n: string) => n.normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').slice(-80) || 'file'

/** Phone photos are often 4–8 MB. Shrink big images to a sharp JPEG before upload. */
async function shrink(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 600_000) return file
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale)
    const c = document.createElement('canvas')
    c.width = w; c.height = h
    const ctx = c.getContext('2d')
    if (!ctx) return file
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close()
    const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/jpeg', 0.85))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch { return file }
}

/** Upload a file to Storage and record it. Returns an error message, or null when it worked. */
export async function uploadFile(ownerType: OwnerType, ownerId: string, kind: string, original: File): Promise<string | null> {
  if (!/^(image\/|application\/pdf$)/.test(original.type)) return 'Only photos and PDF files can be uploaded.'
  const file = await shrink(original)
  if (file.size > 20 * 1024 * 1024) return 'That file is over 20 MB. Try a smaller scan or photo.'
  const path = `${ownerType}/${ownerId}/${crypto.randomUUID()}-${safeName(file.name)}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false })
  if (error) return /row-level security|unauthorized|403/i.test(error.message) ? 'You have view-only access. Ask an admin to make you an editor.' : /bucket not found/i.test(error.message) ? 'File storage isn’t set up yet. Run the latest schema.sql section in Supabase.' : `Upload failed: ${error.message}`
  const { error: rowErr } = await supabase.from('files').insert({ owner_type: ownerType, owner_id: ownerId, kind, name: file.name, path, mime: file.type, size: file.size })
  if (rowErr) {
    await supabase.storage.from(BUCKET).remove([path])
    return `Upload failed: ${rowErr.message}`
  }
  return null
}

/** A short-lived private link (5 minutes). */
export async function fileUrl(f: Pick<FileRow, 'path' | 'name'>, download = false): Promise<string | null> {
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(f.path, 300, download ? { download: f.name } : undefined)
  return data?.signedUrl ?? null
}

export async function openFile(f: FileRow, download = false) {
  // Open the tab first (synchronously) so phones don't block it as a pop-up.
  const w = download ? null : window.open('', '_blank')
  const url = await fileUrl(f, download)
  if (!url) { w?.close(); return false }
  if (w) w.location.href = url
  else { const a = document.createElement('a'); a.href = url; a.download = f.name; document.body.appendChild(a); a.click(); a.remove() }
  return true
}

export async function removeFile(f: FileRow): Promise<string | null> {
  const { error } = await supabase.storage.from(BUCKET).remove([f.path])
  if (error) return `Not deleted: ${error.message}`
  const { error: rowErr } = await supabase.from('files').delete().eq('id', f.id)
  return rowErr ? `Not deleted: ${rowErr.message}` : null
}

/** Remove every file that belongs to a record (used when the record is deleted). */
export async function removeAllFiles(files: FileRow[], ownerType: OwnerType, ownerId: string) {
  const mine = files.filter(f => f.owner_type === ownerType && f.owner_id === ownerId)
  if (!mine.length) return
  await supabase.storage.from(BUCKET).remove(mine.map(f => f.path))
  await supabase.from('files').delete().eq('owner_type', ownerType).eq('owner_id', ownerId)
}

export const fileSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
