import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useData } from '../data/DataContext'
import { supabase } from '../lib/supabase'
import {
  amount, boqTotals, bySection, DEFAULT_ASSUMPTIONS, estimateCost, pdfPageCount, priceItems, readDwg, readDxf, splitPdf,
  takeoffPdf, takeoffSummary, type TakeoffItem,
} from '../lib/boq'
import { uploadFile } from '../lib/files'
import { fmt, fmt0, niceDate, num } from '../lib/format'
import { BOQ_SECTIONS, BOQ_UNITS, type Boq, type BoqAssumptions, type BoqItem, type BoqRate } from '../lib/types'
import { ConfirmDelete, Empty, Field, Pill, Section, Tile } from '../components/ui'
import { Icon } from '../components/icons'

const STATUS: Record<Boq['status'], [string, string]> = { reading: ['soon', 'Reading drawings'], draft: ['upcoming', 'Draft'], final: ['paid', 'Final'] }
const letter = (s: string) => String.fromCharCode(65 + Math.max(0, (BOQ_SECTIONS as readonly string[]).indexOf(s)))

export default function BoqView({ id }: { id: string | null }) {
  const d = useData()
  if (['boq_rates', 'boqs', 'boq_items'].some(t => d.missing.includes(t as never))) return (
    <div className="view"><Section title="BOQ & estimates"><p className="note">This page needs the latest database update. Run the “BOQ &amp; estimates” section of <code>supabase/schema.sql</code> in the Supabase SQL Editor, then reload.</p></Section></div>
  )
  if (id === 'new') return <NewBoq />
  if (id === 'rates') return <RateList />
  if (id) {
    const boq = d.boqs.find(b => b.id === id)
    return boq ? <BoqPage boq={boq} /> : <div className="view"><Section title="Not found"><p className="note">This BOQ was deleted. <a href="#boq">Back to BOQs</a></p></Section></div>
  }
  return <BoqList />
}

/* ---------------- list ---------------- */
function BoqList() {
  const d = useData()
  const rows = useMemo(() => [...d.boqs].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '')).map(b => ({ b, t: boqTotals(b, d.boq_items.filter(i => i.boq_id === b.id)) })), [d.boqs, d.boq_items])
  const priced = d.boq_rates.filter(r => r.rate != null).length
  return (
    <div className="view">
      <div className="tiles">
        <Tile label="BOQs" value={d.boqs.length} sub={`${d.boqs.filter(b => b.status === 'draft').length} draft · ${d.boqs.filter(b => b.status === 'final').length} final`} />
        <Tile label="Rate list" value={d.boq_rates.length} sub={`${priced} with a rate`} />
        <Tile label="Latest estimate" value={rows[0] ? fmt0(rows[0].t.total) : '–'} sub={rows[0] ? rows[0].b.title : 'MVR'} total />
      </div>
      <Section title="BOQ & estimates" intro="Upload drawings (PDF, DXF or DWG) and the AI measures the quantities and prices them from Maavel’s rate list. Every BOQ starts as a draft for you to check."
        action={<div className="head-actions">
          <a className="btnlink" href="#boq/new" aria-disabled={!d.canEdit}>New BOQ</a>
          <a className="quickbtn" href="#boq/rates"><Icon name="estimate" size={16} /><span>Rate list</span></a>
        </div>}>
        <div className="tablewrap"><table>
          <thead><tr><th>BOQ</th><th className="hide-sm">Status</th><th className="num">Total (MVR)</th></tr></thead>
          <tbody>
            {!rows.length ? <Empty cols={3}>No BOQs yet. Tap New BOQ and upload a drawing set.</Empty> : rows.map(({ b, t }) => (
              <tr key={b.id} className="clickable" onClick={() => { location.hash = `boq/${b.id}` }}>
                <td><a className="link plain" href={`#boq/${b.id}`} onClick={e => e.stopPropagation()}>{b.title}</a>
                  <span className="sub">{[d.projects.find(p => p.id === b.project_id)?.name, b.created_at && niceDate(b.created_at.slice(0, 10))].filter(Boolean).join(' · ')}<span className="show-sm"> · {STATUS[b.status][1]}</span></span></td>
                <td className="hide-sm"><Pill kind={STATUS[b.status][0]}>{STATUS[b.status][1]}</Pill></td>
                <td className="num">{b.status === 'reading' ? '…' : fmt0(t.total)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Section>
    </div>
  )
}

/* ---------------- new BOQ: upload, assumptions, progress ---------------- */
type Step = { label: string; state: 'wait' | 'run' | 'done' | 'fail'; detail?: string }

function NewBoq() {
  const d = useData()
  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [pages, setPages] = useState(0)
  const [a, setA] = useState<BoqAssumptions>(DEFAULT_ASSUMPTIONS)
  const [steps, setSteps] = useState<Step[] | null>(null)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)

  const kind = (f: File) => (/\.pdf$/i.test(f.name) || f.type === 'application/pdf' ? 'pdf' : /\.dxf$/i.test(f.name) ? 'dxf' : /\.dwg$/i.test(f.name) ? 'dwg' : 'other')
  const cad = files.filter(f => kind(f) === 'dxf' || kind(f) === 'dwg').length

  async function pick(list: FileList | null) {
    const chosen = [...(list ?? [])]
    const bad = chosen.filter(f => kind(f) === 'other')
    if (bad.length) d.toast(`Only PDF, DXF and DWG files can be used (${bad.map(f => f.name).join(', ')} skipped).`)
    const ok = chosen.filter(f => kind(f) !== 'other')
    const next = [...files, ...ok]
    setFiles(next)
    if (!title && ok[0]) setTitle(ok[0].name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '))
    let p = 0
    for (const f of next.filter(f => kind(f) === 'pdf')) p += await pdfPageCount(f)
    setPages(p)
    if (input.current) input.current.value = ''
  }

  const set = <K extends keyof BoqAssumptions>(k: K, v: BoqAssumptions[K]) => setA(x => ({ ...x, [k]: v }))
  const upd = (i: number, patch: Partial<Step>) => setSteps(s => s && s.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  async function start() {
    if (!files.length) { d.toast('Add at least one drawing.'); return }
    setError('')
    const boqId = crypto.randomUUID()
    const plan: Step[] = [
      { label: 'Saving drawings', state: 'wait' },
      ...files.map(f => ({ label: `Reading ${f.name}`, state: 'wait' as const })),
      { label: 'Merging and pricing', state: 'wait' },
      { label: 'Saving the BOQ', state: 'wait' },
    ]
    setSteps(plan)
    const save = (patch: Partial<Boq>) => supabase.from('boqs').update(patch).eq('id', boqId)
    const { error: e0 } = await supabase.from('boqs').insert({
      id: boqId, title: title.trim() || 'New BOQ', project_id: projectId || null, status: 'reading', assumptions: a,
      source: { files: files.map(f => ({ name: f.name, kind: kind(f) })), progress: 'Starting' },
    })
    if (e0) { setError(e0.message); upd(0, { state: 'fail' }); return }
    d.reload('boqs')

    // 1. keep the PDF drawings with the BOQ
    upd(0, { state: 'run' })
    for (const f of files.filter(f => kind(f) === 'pdf')) await uploadFile('boq', boqId, 'Drawing', f)
    d.reload('files')
    upd(0, { state: 'done' })

    // 2. takeoff, one file (and one chunk) at a time
    const items: TakeoffItem[] = []
    const notes: string[] = []
    for (const [i, f] of files.entries()) {
      const s = i + 1
      upd(s, { state: 'run' })
      try {
        if (kind(f) === 'pdf') {
          const chunks = await splitPdf(f)
          for (const [c, chunk] of chunks.entries()) {
            upd(s, { detail: `sheets ${chunk.pages}${chunks.length > 1 ? ` (${c + 1} of ${chunks.length})` : ''}` })
            await save({ source: { files: files.map(x => ({ name: x.name, kind: kind(x) })), progress: `Reading ${f.name}, sheets ${chunk.pages}` } })
            const r = await takeoffPdf(chunk.blob, `${chunk.pages} of ${f.name}`, a)
            items.push(...r.items); notes.push(...r.assumptions)
          }
        } else {
          upd(s, { detail: kind(f) === 'dwg' ? 'opening the DWG file' : 'measuring the drawing' })
          let summary
          try { summary = kind(f) === 'dwg' ? await readDwg(f) : await readDxf(f) }
          catch { throw new Error(kind(f) === 'dwg' ? `${f.name} could not be opened. In AutoCAD use Save As → DXF, or Plot → PDF, and upload that instead.` : `${f.name} could not be read as a DXF file.`) }
          upd(s, { detail: summary.notes.length ? 'plotted sheet: reading sizes from the text and scale' : `${summary.layers.length} layers, ${summary.blocks.reduce((n, b) => n + b.count, 0)} blocks` })
          if (summary.notes.length) notes.push(`${f.name}: ${summary.notes[0]}`)
          const r = await takeoffSummary(summary, a)
          items.push(...r.items); notes.push(...r.assumptions)
        }
        upd(s, { state: 'done', detail: `${items.length} items so far` })
      } catch (e) {
        upd(s, { state: 'fail', detail: e instanceof Error ? e.message : 'Failed' })
        notes.push(`${f.name} was skipped: ${e instanceof Error ? e.message : 'could not be read'}`)
      }
    }
    if (!items.length) {
      setError('No quantities could be taken from these drawings. Check the files and try again.')
      await save({ status: 'draft', source: { files: files.map(x => ({ name: x.name, kind: kind(x) })), error: 'No items' } })
      d.reload('boqs')
      return
    }

    // 3. merge + price against Maavel's rate list
    const pi = files.length + 1
    upd(pi, { state: 'run', detail: `${items.length} items` })
    let priced: (TakeoffItem & { rate: number | null; rate_source: BoqItem['rate_source']; rate_note: string })[] = []
    let checks: string[] = []
    try {
      const r = await priceItems(items, d.boq_rates, a)
      checks = r.checks
      const byCode = new Map(d.boq_rates.map(x => [x.code, x]))
      priced = r.items.map(it => {
        const own = it.rate_code ? byCode.get(it.rate_code) : undefined
        if (own && own.rate != null) return { ...it, rate: num(own.rate), rate_source: 'maavel' as const, rate_note: `${own.code} ${own.description}` }
        const sug = (it as unknown as { suggested_rate: number | null }).suggested_rate
        return { ...it, rate: sug ?? null, rate_source: sug != null ? 'suggested' as const : 'manual' as const, rate_note: it.rate_note || (own ? `${own.code} (no rate set yet)` : '') }
      })
      upd(pi, { state: 'done', detail: `${priced.length} items after merging` })
    } catch (e) {
      priced = items.map(it => ({ ...it, rate: null, rate_source: 'manual' as const, rate_note: '' }))
      upd(pi, { state: 'fail', detail: `${e instanceof Error ? e.message : 'Pricing failed'}. Saved without rates.` })
    }

    // 4. save items
    const si = files.length + 2
    upd(si, { state: 'run' })
    const rows = priced.sort((x, y) => (BOQ_SECTIONS as readonly string[]).indexOf(x.section) - (BOQ_SECTIONS as readonly string[]).indexOf(y.section)).map((it, n) => ({
      boq_id: boqId, section: (BOQ_SECTIONS as readonly string[]).includes(it.section) ? it.section : 'Other', description: it.description, unit: it.unit,
      qty: Math.round(num(it.qty) * 100) / 100, rate: it.rate, rate_source: it.rate_source, rate_note: it.rate_note ?? '',
      confidence: it.confidence, basis: it.basis, sheet: it.sheet, sort: n,
    }))
    const { error: e1 } = await supabase.from('boq_items').insert(rows)
    await save({ status: 'draft', assumptions: { ...a, ai: [...new Set(notes)].slice(0, 40), checks }, source: { files: files.map(x => ({ name: x.name, kind: kind(x) })) } })
    await Promise.all([d.reload('boq_items'), d.reload('boqs')])
    if (e1) { upd(si, { state: 'fail', detail: e1.message }); setError(e1.message); return }
    upd(si, { state: 'done', detail: `${rows.length} lines` })
    setTimeout(() => { location.hash = `boq/${boqId}` }, 600)
  }

  const running = !!steps && !error && steps.some(s => s.state === 'run' || s.state === 'wait')
  // Closing or reloading the tab would stop the drawings being read: ask first.
  useEffect(() => {
    if (!running) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [running])
  return (
    <div className="view">
      <p className="crumbs"><a href="#boq">‹ All BOQs</a></p>
      <Section title="New BOQ from drawings" intro="Upload the drawing set: PDF plans, sections and schedules, or the CAD files (DXF or DWG). Add a few assumptions the drawings may not show.">
        {!steps ? <>
          <div className="grid2">
            <Field label="BOQ title"><input value={title} placeholder="e.g. Hulhumalé 2-storey house" onChange={e => setTitle(e.target.value)} /></Field>
            <Field label="Project (optional)"><select value={projectId} onChange={e => setProjectId(e.target.value)}>
              <option value="">Not linked to a project</option>
              {d.projects.filter(p => p.status !== 'Completed').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></Field>
          </div>
          <div className="dropzone">
            <Icon name="upload" size={22} />
            <p><b>Add drawings</b><span className="sub">PDF, DXF or DWG. You can add several files.</span></p>
            <button type="button" className="primary small" onClick={() => input.current?.click()}>Choose files</button>
            <input ref={input} type="file" hidden multiple accept=".pdf,.dxf,.dwg,application/pdf" onChange={e => pick(e.target.files)} />
          </div>
          {files.length > 0 && (
            <ul className="filechips">
              {files.map((f, i) => (
                <li key={f.name + i}><span className="ftag">{kind(f).toUpperCase()}</span><span className="fn">{f.name}</span>
                  <button type="button" className="ficonbtn" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}><Icon name="close" size={14} /></button></li>
              ))}
            </ul>
          )}
          <fieldset className="box"><legend>Assumptions</legend>
            <div className="grid2">
              <Field label="Number of floors"><input type="number" min="1" inputMode="numeric" value={a.floors} onChange={e => set('floors', Number(e.target.value) || 1)} /></Field>
              <Field label="Floor-to-floor height (m)"><input type="number" min="2" step="0.1" inputMode="decimal" value={a.floorHeight} onChange={e => set('floorHeight', Number(e.target.value) || 3.2)} /></Field>
              <Field label="Wall blocks"><select value={a.blockMm} onChange={e => set('blockMm', Number(e.target.value))}><option value={100}>100 mm</option><option value={150}>150 mm</option><option value={200}>200 mm</option></select></Field>
              <Field label="Slab thickness (mm)"><input type="number" min="100" step="25" inputMode="numeric" value={a.slabMm} onChange={e => set('slabMm', Number(e.target.value) || 150)} /></Field>
              <Field label="Finishes"><select value={a.finishes} onChange={e => set('finishes', e.target.value as BoqAssumptions['finishes'])}><option value="basic">Basic</option><option value="standard">Standard</option><option value="high">High-end</option></select></Field>
              <label className="check"><input type="checkbox" checked={a.includeMep} onChange={e => set('includeMep', e.target.checked)} /> Include plumbing and electrical</label>
              <Field label="Anything else the AI should know" wide><input value={a.notes} placeholder="e.g. piled foundations, roof is RC slab, island site" onChange={e => set('notes', e.target.value)} /></Field>
            </div>
          </fieldset>
          <div className="startbar">
            <p className="note">{files.length ? `${files.length} file${files.length === 1 ? '' : 's'}${pages ? `, ${pages} PDF page${pages === 1 ? '' : 's'}` : ''}. AI cost about US$${estimateCost(pages, cad).toFixed(2)}. Takes roughly ${Math.max(1, Math.round((Math.ceil(pages / 4) + cad) * 1 + 1))} minute(s).` : 'Add drawings to see the cost.'}</p>
            <button className="primary" disabled={!files.length || !d.canEdit} onClick={start}>Make BOQ</button>
          </div>
        </> : (
          <div className="stepper" aria-live="polite">
            {steps.map((s, i) => (
              <div key={i} className={`step ${s.state}`}>
                <span className="dot" aria-hidden>{s.state === 'done' ? <Icon name="check" size={14} /> : s.state === 'fail' ? '!' : s.state === 'run' ? <span className="spin" /> : i + 1}</span>
                <span className="lbl2"><b>{s.label}</b>{s.detail && <small>{s.detail}</small>}</span>
              </div>
            ))}
            {running && <p className="note">Keep this page open while the drawings are read. You can switch tabs.</p>}
            {error && <p className="banner">{error} <a href="#boq">Back to BOQs</a></p>}
          </div>
        )}
      </Section>
    </div>
  )
}

/* ---------------- one BOQ ---------------- */
function BoqPage({ boq }: { boq: Boq }) {
  const d = useData()
  const items = useMemo(() => d.boq_items.filter(i => i.boq_id === boq.id).sort(bySection), [d.boq_items, boq.id])
  const t = boqTotals(boq, items)
  const project = d.projects.find(p => p.id === boq.project_id)
  const [show, setShow] = useState<'all' | 'check'>('all')
  const [title, setTitle] = useState(boq.title)
  const [allNotes, setAllNotes] = useState(false)
  const groups = BOQ_SECTIONS.map(s => [s, items.filter(i => i.section === s && (show === 'all' || i.rate_source === 'suggested' || i.rate == null || i.confidence === 'low'))] as const).filter(([, l]) => l.length)

  const saveBoq = (patch: Partial<Boq>) => d.upsert('boqs', { id: boq.id, title: boq.title, ...patch })
  const saveItem = (it: BoqItem, patch: Partial<BoqItem>) => d.upsert('boq_items', { ...it, ...patch })

  async function acceptRate(it: BoqItem, toList: boolean) {
    await saveItem(it, { rate_source: 'manual', rate_note: `${it.rate_note ? `${it.rate_note} · ` : ''}accepted` })
    if (toList) {
      // The AI names the matched rate code at the start of its note (e.g. "SUB-01 rate empty; ...")
      const code = it.rate_note.match(/^([A-Z]{2,4}-\d{2,3})\b/)?.[1]
      const own = code ? d.boq_rates.find(r => r.code === code && r.unit === it.unit) : undefined
      const ok = own
        ? await d.upsert('boq_rates', { ...own, rate: it.rate })
        : await d.upsert('boq_rates', { code: '', section: it.section, description: it.description, unit: it.unit, rate: it.rate, notes: 'Added from a BOQ' })
      if (ok) d.toast(own ? `${own.code} set to MVR ${fmt(it.rate ?? 0)} in the rate list` : 'Rate saved to the Maavel rate list')
    }
  }
  async function addItem(section: string) {
    await d.upsert('boq_items', { boq_id: boq.id, section, description: 'New item', unit: 'nos', qty: 0, rate: null, rate_source: 'manual', rate_note: '', confidence: 'high', basis: 'Added by hand', sheet: '', sort: items.length })
  }
  async function del() {
    if (await d.remove('boqs', boq.id)) { d.reload('boq_items'); location.hash = 'boq'; d.toast('BOQ deleted') }
  }
  function csv() {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [['Item', 'Section', 'Description', 'Unit', 'Qty', 'Rate (MVR)', 'Amount (MVR)', 'Rate source', 'Confidence', 'Basis'].map(esc).join(',')]
    let n = 0, cur = ''
    for (const it of items) { if (it.section !== cur) { cur = it.section; n = 0 } n++; lines.push([`${letter(it.section)}.${n}`, it.section, it.description, it.unit, it.qty, it.rate ?? '', amount(it).toFixed(2), it.rate_source, it.confidence, it.basis].map(esc).join(',')) }
    lines.push('', ['', '', 'Direct cost', '', '', '', t.direct.toFixed(2)].map(esc).join(','), ['', '', `Overhead & profit ${boq.overhead_pct}%`, '', '', '', t.overhead.toFixed(2)].map(esc).join(','), ['', '', `Contingency ${boq.contingency_pct}%`, '', '', '', t.contingency.toFixed(2)].map(esc).join(','), ['', '', 'Total', '', '', '', t.total.toFixed(2)].map(esc).join(','))
    const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = `${boq.title.replace(/[^\w]+/g, '-')}-BOQ.csv`; a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div className="view">
      <p className="crumbs"><a href="#boq">‹ All BOQs</a></p>
      <section className="profile-head">
        <div className="grow">
          <input className="titleinput" aria-label="BOQ title" value={title} disabled={!d.canEdit} onChange={e => setTitle(e.target.value)} onBlur={() => title.trim() && title !== boq.title && saveBoq({ title: title.trim() })} />
          <p>{[project ? <a key="p" className="plain" href={`#projects/${project.id}`}>{project.name}</a> : 'Not linked to a project', boq.created_at && niceDate(boq.created_at.slice(0, 10)), `${items.length} items`].filter(Boolean).map((x, i) => <Fragment key={i}>{i > 0 && ' · '}{x}</Fragment>)}</p>
          <p className="pills"><Pill kind={STATUS[boq.status][0]}>{STATUS[boq.status][1]}</Pill>{boq.status === 'reading' && boq.source.progress && <span className="sub">{boq.source.progress}</span>}</p>
        </div>
        <div className="head-actions">
          <button onClick={() => import('../lib/pdf').then(m => m.boqPdf(boq, items, project?.name))}>PDF</button>
          <button onClick={csv}>Excel (CSV)</button>
          {d.canEdit && <button className="primary" onClick={() => saveBoq({ status: boq.status === 'final' ? 'draft' : 'final' })}>{boq.status === 'final' ? 'Back to draft' : 'Mark final'}</button>}
        </div>
      </section>

      <div className="tiles">
        <Tile label="Direct cost" value={fmt0(t.direct)} sub="MVR, measured items" />
        <Tile label="To check" value={t.unpriced + t.suggested} sub={`${t.suggested} suggested rate${t.suggested === 1 ? '' : 's'} · ${t.unpriced} unpriced`} />
        <Tile label="Low confidence" value={items.filter(i => i.confidence === 'low').length} sub="Quantities to verify" />
        <Tile label="Total" value={fmt0(t.total)} sub={`MVR incl. ${boq.overhead_pct}% O&P, ${boq.contingency_pct}% contingency`} total />
      </div>

      {(boq.assumptions.ai?.length || boq.assumptions.checks?.length) ? (
        <Section title="What the AI assumed and flagged" intro="Read these before relying on the totals.">
          <ul className="notes-list">
            {[...(boq.assumptions.checks ?? []).map(c => [c, true] as const), ...(boq.assumptions.ai ?? []).map(c => [c, false] as const)].slice(0, allNotes ? undefined : 5).map(([c, warn], i) => (
              <li key={i} className={warn ? 'warn' : ''}>{warn && <Icon name="alert" size={14} />}{c}</li>
            ))}
          </ul>
          {(boq.assumptions.checks?.length ?? 0) + (boq.assumptions.ai?.length ?? 0) > 5 && (
            <button type="button" className="link" onClick={() => setAllNotes(v => !v)}>{allNotes ? 'Show fewer' : `Show all ${(boq.assumptions.checks?.length ?? 0) + (boq.assumptions.ai?.length ?? 0)} notes`}</button>
          )}
        </Section>
      ) : null}

      <Section title="Bill of quantities" intro="Edits save when you leave a field. Orange rates are AI suggestions: tick to accept."
        action={<div className="seg2" role="radiogroup" aria-label="Show">
          <button role="radio" aria-checked={show === 'all'} onClick={() => setShow('all')}>All items</button>
          <button role="radio" aria-checked={show === 'check'} onClick={() => setShow('check')}>To check ({items.filter(i => i.rate_source === 'suggested' || i.rate == null || i.confidence === 'low').length})</button>
        </div>}>
        <div className="tablewrap"><table className="boq">
          <thead><tr><th>Item</th><th>Description</th><th>Unit</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th>{d.canEdit && <th />}</tr></thead>
          <tbody>
            {!groups.length && <Empty cols={7}>{items.length ? 'Nothing to check. Every line has a confirmed rate.' : 'No items yet.'}</Empty>}
            {groups.map(([s, list]) => (
              <Fragment key={s}>
                <tr className="secrow"><td colSpan={d.canEdit ? 7 : 6}><b>{letter(s)}. {s}</b><span className="num">{fmt0(t.sections.find(x => x[0] === s)?.[1] ?? 0)}</span></td></tr>
                {list.map((it, n) => <BoqRow key={`${it.id}|${it.description}|${it.qty}|${it.rate}`} no={`${letter(s)}.${n + 1}`} it={it} canEdit={d.canEdit} onSave={p => saveItem(it, p)} onAccept={toList => acceptRate(it, toList)} onDelete={() => d.remove('boq_items', it.id)} />)}
                {d.canEdit && show === 'all' && <tr className="addrow"><td colSpan={7}><button type="button" className="link" onClick={() => addItem(s)}>+ Add item to {s}</button></td></tr>}
              </Fragment>
            ))}
          </tbody>
        </table></div>
        {d.canEdit && show === 'all' && <div className="row"><Field label="Add a section"><select value="" onChange={e => e.target.value && addItem(e.target.value)}><option value="">Choose a section…</option>{BOQ_SECTIONS.filter(s => !groups.some(g => g[0] === s)).map(s => <option key={s}>{s}</option>)}</select></Field></div>}
      </Section>

      <div className="cols">
        <Section title="Summary">
          <dl className="facts">
            {t.sections.map(([s, v]) => <Fragment key={s}><dt>{letter(s)}. {s}</dt><dd>{fmt(v)}</dd></Fragment>)}
            <dt><b>Direct cost</b></dt><dd><b>{fmt(t.direct)}</b></dd>
            <dt>Overhead &amp; profit <PctInput key={`o${boq.overhead_pct}`} value={boq.overhead_pct} disabled={!d.canEdit} onSave={v => saveBoq({ overhead_pct: v })} /></dt><dd>{fmt(t.overhead)}</dd>
            <dt>Contingency <PctInput key={`c${boq.contingency_pct}`} value={boq.contingency_pct} disabled={!d.canEdit} onSave={v => saveBoq({ contingency_pct: v })} /></dt><dd>{fmt(t.contingency)}</dd>
            <dt><b>Total (MVR)</b></dt><dd><b>{fmt(t.total)}</b></dd>
          </dl>
          {project && d.canEdit && <button onClick={async () => { if (await d.upsert('projects', { ...project, budget: Math.round(t.total) })) d.toast(`${project.name} budget set to MVR ${fmt0(t.total)}`) }}>Use total as {project.name} budget</button>}
        </Section>
        <Section title="Drawings and details">
          <dl className="facts">
            <dt>Files</dt><dd>{(boq.source.files ?? []).map(f => f.name).join(', ') || '–'}</dd>
            <dt>Floors</dt><dd>{boq.assumptions.floors ?? '–'}</dd>
            <dt>Floor height</dt><dd>{boq.assumptions.floorHeight ? `${boq.assumptions.floorHeight} m` : '–'}</dd>
            <dt>Walls</dt><dd>{boq.assumptions.blockMm ? `${boq.assumptions.blockMm} mm blocks` : '–'}</dd>
            <dt>Finishes</dt><dd className="cap">{boq.assumptions.finishes ?? '–'}</dd>
          </dl>
          {d.canEdit && <div className="row"><ConfirmDelete label="Delete this BOQ" onConfirm={del} /></div>}
        </Section>
      </div>
    </div>
  )
}

function PctInput({ value, onSave, disabled }: { value: number; onSave: (v: number) => void; disabled?: boolean }) {
  const [v, setV] = useState(String(value))
  return <input className="pct" type="number" min="0" step="0.5" inputMode="decimal" value={v} disabled={disabled} aria-label="Percent" onChange={e => setV(e.target.value)} onBlur={() => Number(v) !== value && onSave(Number(v) || 0)} />
}

function BoqRow({ no, it, canEdit, onSave, onAccept, onDelete }: { no: string; it: BoqItem; canEdit: boolean; onSave: (p: Partial<BoqItem>) => void; onAccept: (toList: boolean) => void; onDelete: () => void }) {
  const [desc, setDesc] = useState(it.description)
  const [qty, setQty] = useState(String(it.qty))
  const [rate, setRate] = useState(it.rate == null ? '' : String(it.rate))
  const blurRate = () => {
    const next = rate === '' ? null : Number(rate)
    if (next !== it.rate) onSave({ rate: next, rate_source: 'manual' })
  }
  return (
    <tr className={`boqrow conf-${it.confidence}${it.rate_source === 'suggested' ? ' sugg' : ''}`}>
      <td className="nowrap cat">{no}</td>
      <td className="desc">
        {canEdit ? <textarea rows={1} value={desc} aria-label="Description" onChange={e => setDesc(e.target.value)} onBlur={() => desc.trim() && desc !== it.description && onSave({ description: desc.trim() })} /> : it.description}
        <span className="sub" title={it.basis}>{it.confidence !== 'high' && <span className={`conf ${it.confidence}`}>{it.confidence} confidence</span>}{it.basis}</span>
      </td>
      <td>{canEdit ? <select className="unit" value={it.unit} aria-label="Unit" onChange={e => onSave({ unit: e.target.value })}>{[...new Set([...BOQ_UNITS, it.unit])].map(u => <option key={u}>{u}</option>)}</select> : it.unit}</td>
      <td className="num">{canEdit ? <input className="cell" type="number" step="0.01" inputMode="decimal" value={qty} aria-label="Quantity" onChange={e => setQty(e.target.value)} onBlur={() => Number(qty) !== it.qty && onSave({ qty: Number(qty) || 0 })} /> : fmt(it.qty)}</td>
      <td className="num">
        {canEdit ? <input className={`cell${it.rate_source === 'suggested' ? ' sugg' : ''}`} type="number" step="0.01" inputMode="decimal" value={rate} placeholder="Rate" aria-label="Rate" onChange={e => setRate(e.target.value)} onBlur={blurRate} /> : it.rate == null ? '–' : fmt(it.rate)}
        {it.rate_source === 'suggested' && <span className="suggtag" title={it.rate_note}>Suggested{canEdit && <>
          <button type="button" className="chipbtn" onClick={() => onAccept(false)} aria-label="Accept suggested rate"><Icon name="check" size={12} /></button>
          <button type="button" className="chipbtn" onClick={() => onAccept(true)} aria-label="Accept and save to rate list" title="Accept and save to the rate list">+list</button>
        </>}</span>}
        {it.rate_source === 'maavel' && <span className="sub">Maavel rate</span>}
      </td>
      <td className="num">{it.rate == null ? <span className="sub">–</span> : fmt(amount(it))}</td>
      {canEdit && <td><button type="button" className="ficonbtn danger" aria-label={`Delete ${no}`} onClick={onDelete}><Icon name="trash" size={15} /></button></td>}
    </tr>
  )
}

/* ---------------- Maavel rate list ---------------- */
function RateList() {
  const d = useData()
  const [q, setQ] = useState('')
  const rows = d.boq_rates.filter(r => !q.trim() || [r.code, r.section, r.description].join(' ').toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => (BOQ_SECTIONS as readonly string[]).indexOf(a.section) - (BOQ_SECTIONS as readonly string[]).indexOf(b.section) || a.code.localeCompare(b.code))
  return (
    <div className="view">
      <p className="crumbs"><a href="#boq">‹ All BOQs</a></p>
      <Section title="Maavel rate list" intro="Your own unit rates in MVR (supply and fix, before overhead and profit). The BOQ uses these first; where a rate is blank the AI suggests one for you to confirm."
        action={d.canEdit ? <button className="primary" onClick={() => d.upsert('boq_rates', { code: '', section: 'Other', description: 'New rate', unit: 'nos', rate: null, notes: '' })}>Add rate</button> : undefined}>
        <div className="toolbar"><Field label="Search"><input value={q} placeholder="Code or description" onChange={e => setQ(e.target.value)} /></Field></div>
        <div className="tablewrap"><table className="boq">
          <thead><tr><th>Code</th><th>Description</th><th>Unit</th><th className="num">Rate (MVR)</th>{d.canEdit && <th />}</tr></thead>
          <tbody>{!rows.length ? <Empty cols={5}>No rates.</Empty> : rows.map(r => <RateRow key={`${r.id}|${r.code}|${r.description}|${r.rate}`} r={r} canEdit={d.canEdit} />)}</tbody>
        </table></div>
      </Section>
    </div>
  )
}

function RateRow({ r, canEdit }: { r: BoqRate; canEdit: boolean }) {
  const d = useData()
  const [f, setF] = useState(r)
  const save = (patch: Partial<BoqRate>) => d.upsert('boq_rates', { ...r, ...patch })
  if (!canEdit) return <tr className="raterow"><td className="cat">{r.code}</td><td>{r.description}<span className="sub">{r.section}</span></td><td>{r.unit}</td><td className="num">{r.rate == null ? '–' : fmt(r.rate)}</td></tr>
  return (
    <tr className={`raterow${r.rate == null ? ' norate' : ''}`}>
      <td><input className="cell code" value={f.code} aria-label="Code" onChange={e => setF({ ...f, code: e.target.value })} onBlur={() => f.code !== r.code && save({ code: f.code })} /></td>
      <td className="desc"><textarea rows={1} value={f.description} aria-label="Description" onChange={e => setF({ ...f, description: e.target.value })} onBlur={() => f.description !== r.description && save({ description: f.description })} />
        <select className="unit" value={f.section} aria-label="Section" onChange={e => save({ section: e.target.value })}>{BOQ_SECTIONS.map(s => <option key={s}>{s}</option>)}</select></td>
      <td><select className="unit" value={f.unit} aria-label="Unit" onChange={e => save({ unit: e.target.value })}>{[...new Set([...BOQ_UNITS, f.unit])].map(u => <option key={u}>{u}</option>)}</select></td>
      <td className="num"><input className="cell" type="number" step="0.01" inputMode="decimal" placeholder="Set rate" value={f.rate ?? ''} aria-label="Rate" onChange={e => setF({ ...f, rate: e.target.value === '' ? null : Number(e.target.value) })} onBlur={() => f.rate !== r.rate && save({ rate: f.rate })} /></td>
      <td><ConfirmDeleteIcon onConfirm={() => d.remove('boq_rates', r.id)} /></td>
    </tr>
  )
}

function ConfirmDeleteIcon({ onConfirm }: { onConfirm: () => void }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 4000); return () => clearTimeout(t) }, [armed])
  return armed
    ? <button type="button" className="ficonbtn danger armed" onClick={onConfirm}>Delete?</button>
    : <button type="button" className="ficonbtn danger" aria-label="Delete rate" onClick={() => setArmed(true)}><Icon name="trash" size={15} /></button>
}
