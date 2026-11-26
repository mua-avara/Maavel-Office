// BOQ from drawings: read DXF / DWG / PDF in the browser, ask the "boq-generate" function to do the
// takeoff and pricing, and keep everything saved in the boqs / boq_items tables as it goes.
import { supabase } from './supabase'
import { num } from './format'
import { BOQ_SECTIONS, type Boq, type BoqAssumptions, type BoqItem, type BoqRate, type Confidence, type RateSource } from './types'

export const DEFAULT_ASSUMPTIONS: BoqAssumptions = { floors: 1, floorHeight: 3.2, blockMm: 150, slabMm: 150, finishes: 'standard', includeMep: true, notes: '' }

/* ---------------- totals ---------------- */
export const amount = (i: Pick<BoqItem, 'qty' | 'rate'>) => num(i.qty) * num(i.rate)
const sectionRank = (s: string) => { const i = (BOQ_SECTIONS as readonly string[]).indexOf(s); return i < 0 ? 99 : i }
export const bySection = (a: BoqItem, b: BoqItem) => sectionRank(a.section) - sectionRank(b.section) || a.sort - b.sort

export function boqTotals(boq: Boq, items: BoqItem[]) {
  const sections = new Map<string, number>()
  for (const i of [...items].sort(bySection)) sections.set(i.section, (sections.get(i.section) ?? 0) + amount(i))
  const direct = [...sections.values()].reduce((a, v) => a + v, 0)
  const overhead = direct * num(boq.overhead_pct) / 100
  const contingency = (direct + overhead) * num(boq.contingency_pct) / 100
  const unpriced = items.filter(i => i.rate == null).length
  const suggested = items.filter(i => i.rate_source === 'suggested').length
  return { sections: [...sections.entries()], direct, overhead, contingency, total: direct + overhead + contingency, unpriced, suggested }
}

/* ---------------- drawing summary (DXF / DWG) ---------------- */
type Pt = { x: number; y: number }
type Geo = { layer: string; kind: 'line' | 'poly' | 'block' | 'text'; pts?: Pt[]; closed?: boolean; name?: string; text?: string }

export type DrawingSummary = {
  file: string; units: string; unitToMetre: number; extents_m: { width: number; height: number }
  layers: { layer: string; open_length_m: number; closed_shapes: number; closed_area_m2: number; closed_perimeter_m: number; items: number }[]
  blocks: { name: string; layer: string; count: number }[]
  texts: string[]
  notes: string[]
}

const UNIT: Record<number, [string, number]> = { 1: ['inches', 0.0254], 2: ['feet', 0.3048], 4: ['millimetres', 0.001], 5: ['centimetres', 0.01], 6: ['metres', 1] }
const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y)
const pathLength = (pts: Pt[], closed: boolean) => pts.reduce((s, p, i) => (i ? s + dist(pts[i - 1], p) : s), 0) + (closed && pts.length > 2 ? dist(pts[pts.length - 1], pts[0]) : 0)
const polyArea = (pts: Pt[]) => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p.x * q.y - q.x * p.y }, 0)) / 2
const cleanText = (t: string) => t.replace(/\\[A-Za-z][^;\\]*;/g, '').replace(/\\P/g, ' ').replace(/[{}]/g, '').replace(/%%[cdpCDP]/g, '').replace(/\s+/g, ' ').trim()

/** Measure everything per layer and boil it down to a small summary the AI can reason about. */
export function summarise(file: string, geo: Geo[], insunits: number | undefined): DrawingSummary {
  const all = geo.flatMap(g => g.pts ?? [])
  const xs = all.map(p => p.x), ys = all.map(p => p.y)
  const w = xs.length ? Math.max(...xs) - Math.min(...xs) : 0, h = ys.length ? Math.max(...ys) - Math.min(...ys) : 0
  let [units, f] = UNIT[insunits ?? 0] ?? ['', 0]
  if (!f) { [units, f] = Math.max(w, h) > 2000 ? ['millimetres (assumed)', 0.001] : ['metres (assumed)', 1] }
  // Plotted sheets are drawn at paper size (an A0-A4 sheet is under 1.3 m); scale them up by the 1:N printed on the sheet.
  const notes: string[] = []
  const scales = new Map<number, number>()
  for (const g of geo) for (const m of (g.text ?? '').matchAll(/\b1\s*:\s*(\d{2,4})\b/g)) { const n = Number(m[1]); if (n >= 10 && n <= 2000) scales.set(n, (scales.get(n) ?? 0) + 1) }
  if (Math.max(w, h) * f < 1.3 && all.length) {
    const main = [...scales.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    if (main) { f *= main; units += `, plotted sheet scaled 1:${main}`; notes.push(`This is a plotted sheet drawn at paper size. All measurements were multiplied by ${main} (scale 1:${main} printed on the sheet) to give real sizes. Details drawn at other scales (${[...scales.keys()].filter(n => n !== main).join(', ') || 'none found'}) will be wrong; use the dimension text for those.`) }
    else notes.push('This looks like a plotted sheet at paper size and no scale (1:N) was found, so lengths and areas are NOT real sizes. Rely on dimension text and room sizes instead.')
  }
  const counts = new Map<string, number>()
  for (const g of geo) counts.set(g.layer, (counts.get(g.layer) ?? 0) + 1)
  if (geo.length > 200 && Math.max(...counts.values()) / geo.length > 0.85) notes.push('Almost everything is on one layer (an exploded or plotted drawing), so layer names do not say what things are. Lengths on that layer mix walls, furniture, hatching and annotations: do not use them as wall lengths. Use the texts (room names, dimensions, schedules) and say so in the basis.')
  const L = new Map<string, DrawingSummary['layers'][number]>()
  const layer = (n: string) => { if (!L.has(n)) L.set(n, { layer: n, open_length_m: 0, closed_shapes: 0, closed_area_m2: 0, closed_perimeter_m: 0, items: 0 }); return L.get(n)! }
  const B = new Map<string, DrawingSummary['blocks'][number]>()
  const T = new Set<string>()
  for (const g of geo) {
    const l = layer(g.layer || '0'); l.items++
    if ((g.kind === 'line' || g.kind === 'poly') && g.pts && g.pts.length > 1) {
      if (g.closed && g.pts.length > 2) { l.closed_shapes++; l.closed_area_m2 += polyArea(g.pts) * f * f; l.closed_perimeter_m += pathLength(g.pts, true) * f }
      else l.open_length_m += pathLength(g.pts, false) * f
    } else if (g.kind === 'block' && g.name && !g.name.startsWith('*')) {
      const k = `${g.name}|${g.layer}`; const b = B.get(k) ?? { name: g.name, layer: g.layer, count: 0 }; b.count++; B.set(k, b)
    } else if (g.kind === 'text' && g.text) {
      const t = cleanText(g.text); if (t && t.length <= 60) T.add(t)
    }
  }
  const r = (n: number) => Math.round(n * 100) / 100
  return {
    file, units, unitToMetre: f, extents_m: { width: r(w * f), height: r(h * f) },
    layers: [...L.values()].map(l => ({ ...l, open_length_m: r(l.open_length_m), closed_area_m2: r(l.closed_area_m2), closed_perimeter_m: r(l.closed_perimeter_m) }))
      .filter(l => l.open_length_m || l.closed_shapes || l.items > 2).sort((a, b) => b.open_length_m + b.closed_area_m2 - (a.open_length_m + a.closed_area_m2)).slice(0, 60),
    blocks: [...B.values()].sort((a, b) => b.count - a.count).slice(0, 80),
    texts: [...T].slice(0, 200),
    notes,
  }
}

type DxfEntity = { type: string; layer?: string; inPaperSpace?: boolean; vertices?: Pt[]; shape?: boolean; name?: string; text?: string }

/** DXF: parsed in the browser with dxf-parser. */
export async function readDxf(file: File): Promise<DrawingSummary> {
  const { default: DxfParser } = await import('dxf-parser')
  const dxf = new DxfParser().parseSync(await file.text()) as unknown as { header?: Record<string, unknown>; entities?: DxfEntity[] } | null
  if (!dxf?.entities) throw new Error('This DXF file could not be read.')
  const geo: Geo[] = []
  for (const e of dxf.entities) {
    if (e.inPaperSpace) continue
    const layer = e.layer ?? '0'
    if (e.type === 'LINE' && e.vertices) geo.push({ layer, kind: 'line', pts: e.vertices })
    else if ((e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && e.vertices) geo.push({ layer, kind: 'poly', pts: e.vertices, closed: !!e.shape })
    else if (e.type === 'INSERT') geo.push({ layer, kind: 'block', name: e.name })
    else if ((e.type === 'TEXT' || e.type === 'MTEXT') && e.text) geo.push({ layer, kind: 'text', text: e.text })
  }
  return summarise(file.name, geo, num(dxf.header?.$INSUNITS) || undefined)
}

type DwgEntity = { type: string; layer?: string; isInPaperSpace?: boolean; startPoint?: Pt; endPoint?: Pt; vertices?: Pt[]; flag?: number; flags?: number; name?: string; text?: string }

/** DWG: converted in the browser with LibreDWG (WebAssembly, loaded only when needed). */
export async function readDwg(file: File): Promise<DrawingSummary> {
  const { LibreDwg, Dwg_File_Type } = await import('@mlightcad/libredwg-web')
  const lib = await LibreDwg.create('/wasm')
  const ptr = lib.dwg_read_data(await file.arrayBuffer(), Dwg_File_Type.DWG)
  if (ptr == null) throw new Error('DWG_UNREADABLE')
  let db
  try { db = lib.convert(ptr) } finally { lib.dwg_free(ptr) }
  const geo: Geo[] = []
  for (const e of db.entities as unknown as DwgEntity[]) {
    if (e.isInPaperSpace) continue
    const layer = e.layer ?? '0'
    if (e.type === 'LINE' && e.startPoint && e.endPoint) geo.push({ layer, kind: 'line', pts: [e.startPoint, e.endPoint] })
    else if ((e.type === 'LWPOLYLINE' || e.type.startsWith('POLYLINE')) && e.vertices) geo.push({ layer, kind: 'poly', pts: e.vertices, closed: ((e.flag ?? e.flags ?? 0) & 1) === 1 })
    else if (e.type === 'INSERT') geo.push({ layer, kind: 'block', name: e.name })
    else if ((e.type === 'TEXT' || e.type === 'MTEXT') && e.text) geo.push({ layer, kind: 'text', text: e.text })
  }
  return summarise(file.name, geo, (db.header as { INSUNITS?: number }).INSUNITS)
}

/** PDF: split into small chunks so each AI call stays quick. */
export async function splitPdf(file: File, pagesPerChunk = 4): Promise<{ blob: Blob; pages: string }[]> {
  const { PDFDocument } = await import('pdf-lib')
  const src = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true })
  const n = src.getPageCount()
  if (n <= pagesPerChunk) return [{ blob: file, pages: `1–${n}` }]
  const out: { blob: Blob; pages: string }[] = []
  for (let start = 0; start < n; start += pagesPerChunk) {
    const idx = Array.from({ length: Math.min(pagesPerChunk, n - start) }, (_, i) => start + i)
    const doc = await PDFDocument.create()
    for (const p of await doc.copyPages(src, idx)) doc.addPage(p)
    out.push({ blob: new Blob([new Uint8Array(await doc.save())], { type: 'application/pdf' }), pages: `${start + 1}–${start + idx.length}` })
  }
  return out
}

/* ---------------- talking to the boq-generate function ---------------- */
export type TakeoffItem = { section: string; description: string; unit: string; qty: number; basis: string; confidence: Confidence; sheet: string }
export type PricedItem = TakeoffItem & { rate: number | null; rate_source: RateSource; rate_code: string | null; rate_note: string }

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('boq-generate', { body })
  if (!error && data?.ok) return data as T
  if (!error) throw new Error(data?.error ?? 'Nothing came back.')
  const ctx = (error as { context?: Response }).context
  if (ctx && typeof ctx.json === 'function') {
    let msg = ''
    try { const j = await ctx.json(); msg = j?.error ?? '' } catch { /* not JSON */ }
    if (msg) throw new Error(msg)
    if (ctx.status === 404) throw new Error('The BOQ reader is not set up yet: deploy the "boq-generate" function in Supabase.')
  }
  throw new Error(/Failed to send|fetch/i.test(error.message) ? 'Could not reach the BOQ reader. Check your connection.' : error.message)
}

const toBase64 = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

export const takeoffPdf = async (chunk: Blob, label: string, a: BoqAssumptions) =>
  (await call<{ items: TakeoffItem[]; assumptions: string[] }>({ action: 'takeoff', kind: 'pdf', label, assumptions: a, data: await toBase64(chunk) }))
export const takeoffSummary = (summary: DrawingSummary, a: BoqAssumptions) =>
  call<{ items: TakeoffItem[]; assumptions: string[] }>({ action: 'takeoff', kind: 'cad', label: summary.file, assumptions: a, summary })
export const priceItems = (items: TakeoffItem[], rates: BoqRate[], a: BoqAssumptions) =>
  call<{ items: PricedItem[]; checks: string[] }>({
    action: 'price', assumptions: a, items,
    rates: rates.map(r => ({ code: r.code, section: r.section, description: r.description, unit: r.unit, rate: r.rate })),
  })

/** Rough cost for the user before starting (US$), from page count / number of CAD files. */
export const estimateCost = (pdfPages: number, cadFiles: number) => Math.max(0.05, pdfPages * 0.03 + cadFiles * 0.04 + 0.05)

export async function pdfPageCount(file: File) {
  const { PDFDocument } = await import('pdf-lib')
  try { return (await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true })).getPageCount() } catch { return 1 }
}
