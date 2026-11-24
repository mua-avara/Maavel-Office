import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { copyText } from '../lib/copy'

export function Tile({ label, value, sub, total }: { label: string; value: ReactNode; sub?: ReactNode; total?: boolean }) {
  return (
    <div className={`tile${total ? ' total' : ''}`}>
      <small>{label}</small>
      <strong>{typeof value === 'number' || (typeof value === 'string' && /^-?[\d,]+$/.test(value)) ? <CountUp value={value} /> : value}</strong>
      <em>{sub ?? ' '}</em>
    </div>
  )
}

export const Pill = ({ kind, children }: { kind: string; children: ReactNode }) => <span className={`pill ${kind}`}>{children}</span>

export function Section({ title, intro, action, children }: { title: string; intro?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <header className="sec-head">
        <div className="grow"><h2>{title}</h2>{intro && <p>{intro}</p>}</div>
        {action}
      </header>
      {children}
    </section>
  )
}

/** A modal form built on the native <dialog>. */
export function Modal({ open, title, onClose, onSubmit, children, footer, wide }: {
  open: boolean; title: string; onClose: () => void; onSubmit: () => void | Promise<void>; children: ReactNode; footer?: ReactNode; wide?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try { await onSubmit() } finally { setBusy(false) }
  }
  return (
    <dialog ref={ref} className={wide ? 'wide' : ''} onClose={onClose} onCancel={onClose}>
      {open && (
        <form onSubmit={submit}>
          <h3>{title}</h3>
          {children}
          <div className="actions">
            {footer}
            <button type="button" onClick={onClose}>Cancel</button>
            <button className="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      )}
    </dialog>
  )
}

/** A delete button that needs a second tap. */
export function ConfirmDelete({ label = 'Delete', onConfirm }: { label?: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 4000); return () => clearTimeout(t) }, [armed])
  return (
    <button type="button" className="link danger" onClick={() => (armed ? onConfirm() : setArmed(true))}>
      {armed ? 'Tap again to delete' : label}
    </button>
  )
}

export function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return <label className={wide ? 'span2' : undefined}><span className="lbl">{label}</span>{children}</label>
}

export const Empty = ({ cols, children }: { cols: number; children: ReactNode }) => (
  <tr><td colSpan={cols} className="empty">{children}</td></tr>
)

/** Counts a figure up from zero when it first appears or changes (skipped with reduced motion). */
function CountUp({ value }: { value: number | string }) {
  const target = typeof value === 'number' ? value : Number(value.replace(/,/g, ''))
  const comma = typeof value === 'string' && value.includes(',')
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  const [shown, setShown] = useState(still ? target : 0)
  const now = useRef(still ? target : 0)
  useEffect(() => {
    if (still || !Number.isFinite(target)) { now.current = target; return }
    const start = performance.now(), a = now.current, dur = 900
    let raf = 0
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur), e = 1 - (1 - p) ** 4
      now.current = a + (target - a) * e
      setShown(now.current)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, still])
  const n = Math.round(still || !Number.isFinite(target) ? target : shown)
  return <>{comma || Math.abs(n) >= 1000 ? n.toLocaleString('en-US') : n}</>
}

/** A value (e.g. an account number) with a one-tap copy button. */
export function CopyValue({ value, what = 'Account number', onCopied }: { value: string; what?: string; onCopied: (msg: string) => void }) {
  const [done, setDone] = useState(false)
  async function copy(e: { stopPropagation: () => void }) {
    e.stopPropagation()
    if (await copyText(value.replace(/\s+/g, ''))) { setDone(true); setTimeout(() => setDone(false), 1600); onCopied(`${what} copied`) }
    else onCopied('Couldn’t copy. Press and hold the number to select it.')
  }
  return (
    <span className="copyval">
      <code>{value}</code>
      <button type="button" className={`copybtn${done ? ' done' : ''}`} onClick={copy} aria-label={`Copy ${what.toLowerCase()} ${value}`}>{done ? 'Copied' : 'Copy'}</button>
    </span>
  )
}
