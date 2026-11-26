import { supabase } from './supabase'

/** Documents the "scan-document" function knows how to read. */
export type ScanType = 'passport' | 'evisa' | 'vehicle_registration' | 'insurance' | 'road_worthiness' | 'annual_fee' | 'licence'
export type ScanFields = Record<string, string | number | null>
export type ScanResult = { ok: true; fields: ScanFields; found: number } | { ok: false; error: string }

const MAX_SIDE = 2000

/** Turn any photo into a sharp JPEG of at most 2000px (the reader accepts JPG/PNG/WebP/GIF and PDF). */
async function prepare(file: File): Promise<{ mime: string; data: string }> {
  let blob: Blob = file
  let mime = file.type
  if (file.type.startsWith('image/')) {
    try {
      const bmp = await createImageBitmap(file)
      const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
      const c = document.createElement('canvas')
      c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale)
      const ctx = c.getContext('2d')!
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height)
      ctx.drawImage(bmp, 0, 0, c.width, c.height)
      bmp.close()
      const out = await new Promise<Blob | null>(r => c.toBlob(r, 'image/jpeg', 0.9))
      if (out) { blob = out; mime = 'image/jpeg' }
    } catch { /* send the original if the browser can't decode it */ }
  }
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return { mime, data: btoa(bin) }
}

/** Send a document to the "scan-document" Edge Function and get the fields it could read. */
export async function scanDocument(type: ScanType, file: File): Promise<ScanResult> {
  if (!/^(image\/|application\/pdf$)/.test(file.type)) return { ok: false, error: 'Use a photo or a PDF of the document.' }
  if (file.size > 15 * 1024 * 1024) return { ok: false, error: 'That file is too big to read. Use a photo or a PDF under 15 MB.' }
  const body = { type, ...(await prepare(file)) }
  const { data, error } = await supabase.functions.invoke('scan-document', { body })
  if (!error) return data?.ok ? { ok: true, fields: data.fields ?? {}, found: data.found ?? 0 } : { ok: false, error: data?.error ?? 'Nothing came back.' }
  const ctx = (error as { context?: Response }).context
  if (ctx && typeof ctx.json === 'function') {
    try { const j = await ctx.json(); if (j?.error) return { ok: false, error: j.detail ? `${j.error} (${j.detail})` : j.error } } catch { /* not JSON */ }
    if (ctx.status === 404) return { ok: false, error: 'Document scanning isn’t set up yet: the "scan-document" function needs deploying in Supabase.' }
  }
  if (/Failed to send|fetch/i.test(error.message)) return { ok: false, error: 'Couldn’t reach the document reader. Check your connection, or that "scan-document" is deployed.' }
  return { ok: false, error: error.message }
}

/** Helpers for turning scanned values into form values. */
export const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
export const isoDate = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
export const titleCase = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/\b\p{L}/gu, c => c.toUpperCase()) : s)
