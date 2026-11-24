import { useEffect, useMemo, useState } from 'react'
import { useData } from '../data/DataContext'
import { linesFromStaff, monthSummary, payTotals } from '../lib/calc'
import { fmt, fmt0, niceDate, todayStr } from '../lib/format'
import { CATEGORIES, METHODS, type Bill, type Payment } from '../lib/types'
import { ConfirmDelete, CopyValue, Empty, Field, Modal, Pill, Section, Tile } from '../components/ui'

type PayCtx = { bill?: Bill; due?: string; payment?: Payment } | null

/** "Pay to" details for a bill, with the account number copyable. */
function PayTo({ b, toast }: { b: Bill; toast: (m: string) => void }) {
  if (!b.pay_account && !b.pay_name) return null
  return (
    <span className="payto">
      <span className="payto-name">Pay to {b.pay_name || '–'}{b.pay_bank ? ` · ${b.pay_bank}` : ''}</span>
      {b.pay_account && <CopyValue value={b.pay_account} onCopied={toast} />}
    </span>
  )
}

export default function MonthView({ k, action = null }: { k: string; action?: string | null }) {
  const d = useData()
  const c = useMemo(() => monthSummary(k, d.bills, d.payments, d.payroll_months.find(p => p.month === k), d.staff), [k, d.bills, d.payments, d.payroll_months, d.staff])
  const [pay, setPay] = useState<PayCtx>(null)
  const [bill, setBill] = useState<Bill | 'new' | null>(null)
  // "#month/expense" (quick action on the Overview) opens the expense form once.
  const [handled, setHandled] = useState<string | null>(null)
  if (action !== handled) { setHandled(action); if (action === 'expense' && d.canEdit) setPay({}) }
  useEffect(() => { if (action) history.replaceState(null, '', '#month') }, [action])
  const od = c.unpaid.filter(r => r.status.key === 'overdue').length
  const pay$ = c.pr.source === 'none' ? payTotals(linesFromStaff(d.staff, k)) : c.pr

  return (
    <div className="view">
      <div className="toolbar"><div className="grow" /><button className="accent" onClick={() => import('../lib/pdf').then(m => m.expensePdf(c))}>Download expense PDF</button></div>
      <div className="tiles">
        <Tile label="Bills & expenses paid" value={fmt0(c.paidTotal)} sub={`${c.mp.length} payment${c.mp.length === 1 ? '' : 's'}`} />
        <Tile label="Still to pay" value={fmt0(c.dueTotal)} sub={`${c.unpaid.length} bill${c.unpaid.length === 1 ? '' : 's'}${c.payDue ? ' + payroll' : ''}${od ? ` · ${od} overdue` : ''}`} />
        <Tile label="Salaries & allowances" value={c.pr.paid ? fmt0(c.pr.total) : '–'} sub={c.pr.paid ? `Food ${fmt0(c.pr.food)}` : c.pr.source === 'lines' ? 'Payroll not paid yet' : 'Not recorded'} />
        <Tile label="Total spend" value={fmt0(c.total)} sub="Everything paid this month" total />
      </div>

      <Section title="Monthly bills" intro="Rent, utilities, WiFi and other regular bills. Tap a bill’s name to change its amount, due day or payment account; tap Mark paid when you pay it."
        action={<button className="primary" disabled={!d.canEdit} onClick={() => setBill('new')}>Add a bill</button>}>
        <div className="tablewrap"><table>
          <thead><tr><th>Bill</th><th className="hide-xs">Status</th><th className="num">Amount (MVR)</th><th className="hide-sm">Due</th><th className="hide-sm">Category</th><th /></tr></thead>
          <tbody>
            {!c.rows.length ? <Empty cols={6}>No bills yet. Open Manage bills below to add one.</Empty> : c.rows.map(r => {
              const amt = r.paid.length ? r.paid.reduce((a, p) => a + Number(p.amount), 0) : r.bill.amount
              const pill = <Pill kind={r.status.key}>{r.status.label}</Pill>
              return (
                <tr key={r.bill.id}>
                  <td><button type="button" className="link plain" disabled={!d.canEdit} onClick={() => setBill(r.bill)} title="Edit bill">{r.bill.name}</button>
                    <span className="sub">{r.paid.length ? `Paid ${niceDate(r.paid[0].date)}${r.paid[0].method ? ` · ${r.paid[0].method}` : ''}` : r.bill.provider}</span>
                    <PayTo b={r.bill} toast={d.toast} />
                    <span className="show-xs">{pill}</span></td>
                  <td className="hide-xs">{pill}</td>
                  <td className="num">{amt == null ? <span className="sub">Not set</span> : fmt(amt)}</td>
                  <td className="hide-sm">{niceDate(r.due)}</td>
                  <td className="hide-sm cat">{r.bill.category}</td>
                  <td className="num">{r.paid.length
                    ? <button className="small" disabled={!d.canEdit} onClick={() => setPay({ payment: r.paid[0] })}>Edit</button>
                    : <button className="small primary" disabled={!d.canEdit} onClick={() => setPay({ bill: r.bill, due: r.due })}>Mark paid</button>}</td>
                </tr>
              )
            })}
          </tbody>
        </table></div>
      </Section>

      <Section title="Other expenses" intro="One-off costs this month: repairs, materials, transport, fees." action={<button className="primary" disabled={!d.canEdit} onClick={() => setPay({})}>Add expense</button>}>
        <div className="tablewrap"><table>
          <thead><tr><th>Date</th><th>Item</th><th className="hide-sm">Category</th><th className="hide-sm">Method</th><th className="num">Amount (MVR)</th><th /></tr></thead>
          <tbody>
            {!c.other.length ? <Empty cols={6}>No other expenses this month.</Empty> : c.other.map(p => (
              <tr key={p.id}>
                <td className="nowrap">{niceDate(p.date)}</td>
                <td>{p.description}{(p.ref || p.project_id) && <span className="sub">{[p.ref && `Ref ${p.ref}`, d.projects.find(x => x.id === p.project_id)?.name].filter(Boolean).join(' · ')}</span>}</td>
                <td className="hide-sm cat">{p.category}</td><td className="hide-sm cat">{p.method}</td>
                <td className="num">{fmt(p.amount)}</td>
                <td className="num"><button className="small" disabled={!d.canEdit} onClick={() => setPay({ payment: p })}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Section>

      <Section title="Salaries and allowances" intro="From the Payroll tab." action={<a className="btnlink" href="#payroll">Open payroll</a>}>
        {c.pr.source === 'none' && !c.payDue ? <p className="empty">No payroll recorded for this month.</p> : (
          <div>
            <div className="kv"><span>Salaries</span><strong>MVR {fmt(pay$.sal)}</strong></div>
            <div className="kv"><span>Food allowance</span><strong>MVR {fmt(pay$.food)}</strong></div>
            <div className="kv"><span>Phone &amp; other allowances</span><strong>MVR {fmt(pay$.allow)}</strong></div>
            <div className="kv"><span>Status</span><Pill kind={c.pr.paid ? 'paid' : 'soon'}>{c.pr.paid ? 'Paid' : 'Not paid yet'}</Pill></div>
          </div>
        )}
      </Section>

      <section>
        <details>
          <summary>Manage bills</summary>
          <p className="note">Add a new regular bill, change an amount or due day, or turn off a bill you no longer pay.</p>
          <div className="tablewrap"><table>
            <thead><tr><th>Bill</th><th className="num">Amount (MVR)</th><th>Due day</th><th className="hide-sm">Pay to</th><th /></tr></thead>
            <tbody>
              {[...d.bills].sort((a, b) => Number(!a.active) - Number(!b.active) || a.due_day - b.due_day || a.name.localeCompare(b.name)).map(b => (
                <tr key={b.id} className={b.active ? '' : 'inactive'}>
                  <td>{b.name}<span className="sub">{b.category}{b.active ? '' : ' · turned off'}</span></td>
                  <td className="num">{b.amount == null ? <span className="sub">Varies</span> : fmt(b.amount)}</td>
                  <td>{b.due_day}</td>
                  <td className="hide-sm">{b.pay_account || b.pay_name ? <PayTo b={b} toast={d.toast} /> : <span className="cat">{b.provider}{b.account ? ` · ${b.account}` : ''}</span>}</td>
                  <td className="num"><button className="small" disabled={!d.canEdit} onClick={() => setBill(b)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <div className="toolbar" style={{ marginTop: 12 }}><button className="primary" disabled={!d.canEdit} onClick={() => setBill('new')}>Add a bill</button></div>
        </details>
      </section>

      <PaymentDialog k={k} ctx={pay} onClose={() => setPay(null)} />
      <BillDialog bill={bill} onClose={() => setBill(null)} />
    </div>
  )
}

function PaymentDialog({ k, ctx, onClose }: { k: string; ctx: PayCtx; onClose: () => void }) {
  const d = useData()
  const p = ctx?.payment, b = ctx?.bill
  const isBill = Boolean(b || p?.bill_id)
  const [f, setF] = useState({ description: '', category: 'Other', date: '', amount: '', method: 'Bank transfer', ref: '', project_id: '' })
  const [key, setKey] = useState<PayCtx>(null)
  const projectsReady = !d.missing.includes('projects')
  const openProjects = d.projects.filter(x => x.status !== 'Completed' || x.id === f.project_id)
  if (ctx !== key) {
    setKey(ctx)
    if (ctx) setF({
      description: p?.description ?? '', category: p?.category ?? 'Other',
      date: p?.date ?? (todayStr.startsWith(k) ? todayStr : ctx.due ?? `${k}-01`),
      amount: p ? String(p.amount) : b?.amount != null ? String(b.amount) : '',
      method: p?.method || 'Bank transfer', ref: p?.ref ?? '', project_id: p?.project_id ?? '',
    })
  }
  async function save() {
    const amount = Number(f.amount)
    if (!f.date || f.amount === '' || !(amount >= 0)) { d.toast('Enter a date and an amount.'); return }
    if (!isBill && !f.description.trim()) { d.toast('Enter what the expense was for.'); return }
    const row: Partial<Payment> = {
      month: f.date.slice(0, 7), date: f.date, amount, method: f.method, ref: f.ref.trim(),
      ...(projectsReady ? { project_id: f.project_id || null } : {}),
      ...(b ? { bill_id: b.id, description: b.name, category: b.category }
        : p?.bill_id ? { bill_id: p.bill_id, description: p.description, category: p.category }
        : { bill_id: null, description: f.description.trim(), category: f.category }),
    }
    if (p) row.id = p.id
    if (await d.upsert('payments', row)) { onClose(); d.toast('Saved') }
  }
  return (
    <Modal open={!!ctx} title={b ? `Mark paid: ${b.name}` : p ? (p.bill_id ? 'Edit payment' : 'Edit expense') : 'Add expense'} onClose={onClose} onSubmit={save}
      footer={p ? <ConfirmDelete label="Delete payment" onConfirm={async () => { if (await d.remove('payments', p.id)) { onClose(); d.toast('Payment deleted') } }} /> : undefined}>
      {b && (b.pay_account || b.pay_name) && <div className="payto-box"><PayTo b={b} toast={d.toast} /></div>}
      {!isBill && <Field label="Item"><input value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></Field>}
      <div className="row">
        <Field label="Date paid"><input type="date" required value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Amount (MVR)"><input type="number" min="0" step="0.01" inputMode="decimal" required value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} /></Field>
      </div>
      <div className="row">
        {!isBill && <Field label="Category"><select value={f.category} onChange={e => setF({ ...f, category: e.target.value })}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></Field>}
        <Field label="Method"><select value={f.method} onChange={e => setF({ ...f, method: e.target.value })}>{METHODS.map(m => <option key={m}>{m}</option>)}</select></Field>
      </div>
      <Field label="Receipt / reference no."><input value={f.ref} placeholder="Optional" onChange={e => setF({ ...f, ref: e.target.value })} /></Field>
      {projectsReady && openProjects.length > 0 && (
        <Field label="Project / site"><select value={f.project_id} onChange={e => setF({ ...f, project_id: e.target.value })}>
          <option value="">General overhead (no project)</option>
          {openProjects.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select></Field>
      )}
    </Modal>
  )
}

function BillDialog({ bill, onClose }: { bill: Bill | 'new' | null; onClose: () => void }) {
  const d = useData()
  const b = bill && bill !== 'new' ? bill : null
  const [f, setF] = useState({ name: '', category: 'Utilities', amount: '', due_day: '10', provider: '', account: '', active: true, pay_name: '', pay_account: '', pay_bank: '' })
  const payReady = d.bills.length === 0 || d.bills.some(x => 'pay_account' in x)
  const [key, setKey] = useState<typeof bill>(null)
  if (bill !== key) {
    setKey(bill)
    if (bill) setF({ name: b?.name ?? '', category: b?.category ?? 'Utilities', amount: b?.amount != null ? String(b.amount) : '', due_day: String(b?.due_day ?? 10), provider: b?.provider ?? '', account: b?.account ?? '', active: b ? b.active : true, pay_name: b?.pay_name ?? '', pay_account: b?.pay_account ?? '', pay_bank: b?.pay_bank ?? '' })
  }
  async function save() {
    const due = parseInt(f.due_day, 10)
    if (!f.name.trim() || !(due >= 1 && due <= 31)) { d.toast('Enter a name and a due day from 1 to 31.'); return }
    const row: Partial<Bill> = { name: f.name.trim(), category: f.category, amount: f.amount === '' ? null : Number(f.amount), due_day: due, provider: f.provider.trim(), account: f.account.trim(), active: f.active,
      ...(payReady ? { pay_name: f.pay_name.trim(), pay_account: f.pay_account.trim(), pay_bank: f.pay_bank.trim() } : {}) }
    if (b) row.id = b.id
    if (await d.upsert('bills', row)) { onClose(); d.toast('Bill saved') }
  }
  return (
    <Modal open={!!bill} title={b ? 'Edit bill' : 'Add a bill'} onClose={onClose} onSubmit={save}
      footer={b ? <ConfirmDelete label="Delete bill" onConfirm={async () => { if (await d.remove('bills', b.id)) { onClose(); d.toast('Bill deleted. Past payments are kept.') } }} /> : undefined}>
      <Field label="Bill name"><input required value={f.name} placeholder="e.g. Electricity – Goidhoo Apartment" onChange={e => setF({ ...f, name: e.target.value })} /></Field>
      <div className="row">
        <Field label="Category"><select value={f.category} onChange={e => setF({ ...f, category: e.target.value })}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Usual amount (MVR)"><input type="number" min="0" step="0.01" inputMode="decimal" placeholder="Leave blank if it changes" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} /></Field>
      </div>
      <div className="row">
        <Field label="Due day of month"><input type="number" min="1" max="31" required value={f.due_day} onChange={e => setF({ ...f, due_day: e.target.value })} /></Field>
        <label className="check"><input type="checkbox" checked={f.active} onChange={e => setF({ ...f, active: e.target.checked })} /> Still paying this</label>
      </div>
      <div className="row">
        <Field label="Provider"><input value={f.provider} placeholder="e.g. Fenaka, Dhiraagu, landlord" onChange={e => setF({ ...f, provider: e.target.value })} /></Field>
        <Field label="Account / meter no."><input value={f.account} onChange={e => setF({ ...f, account: e.target.value })} /></Field>
      </div>
      {payReady ? (
        <fieldset className="box"><legend>Pay to (bank transfer)</legend>
          <div className="grid2">
            <Field label="Account name"><input value={f.pay_name} placeholder="e.g. Ahmed Ibrahim" onChange={e => setF({ ...f, pay_name: e.target.value })} /></Field>
            <Field label="Bank"><input value={f.pay_bank} placeholder="e.g. BML, MIB" list="banks" onChange={e => setF({ ...f, pay_bank: e.target.value })} /></Field>
            <Field label="Account number" wide><input value={f.pay_account} inputMode="numeric" autoComplete="off" placeholder="e.g. 7730000123456" onChange={e => setF({ ...f, pay_account: e.target.value })} /></Field>
          </div>
          <datalist id="banks"><option>BML</option><option>MIB</option><option>SBI</option><option>CBM</option><option>HBL</option><option>BOC</option><option>MCB</option></datalist>
        </fieldset>
      ) : <p className="note">To save the account name and number, run the latest section of <code>supabase/schema.sql</code> in Supabase.</p>}
    </Modal>
  )
}
