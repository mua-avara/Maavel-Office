import { useMemo, useState } from 'react'
import { useData } from '../data/DataContext'
import { estimate } from '../lib/calc'
import { fmt, fmt0, monthName, niceDate, ordinal, todayStr } from '../lib/format'
import { CATEGORIES, type EstimateItem } from '../lib/types'
import { ConfirmDelete, Empty, Field, Modal, Pill, Section } from '../components/ui'

export default function EstimateView({ k }: { k: string }) {
  const d = useData()
  const [useOther, setUseOther] = useState(true)
  const [cont, setCont] = useState('0')
  const [item, setItem] = useState<EstimateItem | 'new' | null>(null)
  const e = useMemo(() => estimate(k, d.staff, d.bills, d.payments, d.estimate_items, { useOther, contingency: Number(cont) || 0 }),
    [k, d.staff, d.bills, d.payments, d.estimate_items, useOther, cont])

  const rows: [string, number][] = [
    [`Salaries (${e.st.length} staff)`, e.staffBasic], ['Food allowance', e.staffFood], ['Phone & other allowances', e.staffAllow], ['Rent and bills', e.billsTotal],
    ...(e.extras.length ? [[`Additional expenses (${e.extras.length})`, e.extrasTotal] as [string, number]] : []),
    ...(e.useOther ? [['Other expenses (3-month average)', e.otherAvg] as [string, number]] : []),
    ...(e.cont ? [[`Contingency ${e.cont}%`, e.contAmt] as [string, number]] : []),
  ]

  return (
    <div className="view">
      <Section title={`Overhead estimate · ${monthName(k)}`} intro="What Maavel expects to spend on staff, rent, bills and running costs this month. Use the arrows above to change the month."
        action={<button className="accent" onClick={() => import('../lib/pdf').then(m => m.estimatePdf(e))}>Download estimate PDF</button>}>
        <div className="big">MVR {fmt0(e.total)}</div>
        <div className="row">
          <label className="check"><input type="checkbox" checked={useOther} onChange={x => setUseOther(x.target.checked)} /> Include other expenses (average of last 3 months)</label>
          <Field label="Contingency (%)"><input type="number" min="0" max="50" value={cont} onChange={x => setCont(x.target.value)} /></Field>
        </div>
        <div>{rows.map(([a, b]) => <div className="kv" key={a}><span>{a}</span><strong>MVR {fmt0(b)}</strong></div>)}</div>
      </Section>

      <Section title="Additional expenses" intro="Anything else expected this month: materials, travel, repairs, permits, one-off purchases. Added to the total and the PDF."
        action={<button className="primary" disabled={!d.canEdit} onClick={() => setItem('new')}>Add expense</button>}>
        <div className="tablewrap"><table>
          <thead><tr><th>Item</th><th className="hide-sm">Category</th><th className="num">Amount (MVR)</th><th /></tr></thead>
          <tbody>
            {!e.extras.length ? <Empty cols={4}>None added for this month.</Empty> : <>
              {e.extras.map(x => (
                <tr key={x.id}><td>{x.description}</td><td className="hide-sm cat">{x.category}</td><td className="num">{fmt(x.amount)}</td>
                  <td className="num"><button className="small" disabled={!d.canEdit} onClick={() => setItem(x)}>Edit</button></td></tr>
              ))}
              <tr><td><strong>Total</strong></td><td className="hide-sm" /><td className="num"><strong>{fmt(e.extrasTotal)}</strong></td><td /></tr>
            </>}
          </tbody>
        </table></div>
      </Section>

      <Section title="Staff costs" intro="Active staff on the staff list.">
        <div className="tablewrap"><table>
          <thead><tr><th>Name</th><th className="hide-sm">Job</th><th className="num">Basic</th><th className="num">Allowances</th><th className="num">Total</th></tr></thead>
          <tbody>{!e.st.length ? <Empty cols={5}>No active staff.</Empty> : e.st.map(s => (
            <tr key={s.name}><td>{s.name}</td><td className="hide-sm cat">{s.designation}</td><td className="num">{fmt0(s.basic)}</td><td className="num">{fmt0(s.food + s.allow)}</td><td className="num">{fmt0(s.basic + s.food + s.allow)}</td></tr>
          ))}</tbody>
        </table></div>
      </Section>

      <Section title="Rent and bills" intro="Active bills. Bills without a fixed amount use the average paid over the last 3 months.">
        <div className="tablewrap"><table>
          <thead><tr><th>Bill</th><th className="hide-sm">Category</th><th className="hide-sm">Due</th><th className="num">Estimate (MVR)</th></tr></thead>
          <tbody>{!e.billRows.length ? <Empty cols={4}>No active bills.</Empty> : e.billRows.map(r => (
            <tr key={r.name}><td>{r.name}<span className="sub">{r.basis}</span></td><td className="hide-sm cat">{r.category}</td><td className="hide-sm">{ordinal(r.due)}</td><td className="num">{r.amount ? fmt0(r.amount) : <span className="sub">–</span>}</td></tr>
          ))}</tbody>
        </table></div>
      </Section>

      <Section title="Renewals due this month" intro="Staff documents that expire in this month or have already expired. Fees are not included in the total.">
        <div className="tablewrap"><table>
          <thead><tr><th>Name</th><th>Document</th><th>Expires</th></tr></thead>
          <tbody>{!e.renew.length ? <Empty cols={3}>Nothing recorded as expiring. Add visa, permit and medical dates on the Staff tab.</Empty> : e.renew.map(r => (
            <tr key={r.name + r.doc}><td>{r.name}</td><td>{r.doc}</td><td>{niceDate(r.date)} {r.date < todayStr && <Pill kind="overdue">Expired</Pill>}</td></tr>
          ))}</tbody>
        </table></div>
      </Section>

      <ItemDialog k={k} item={item} onClose={() => setItem(null)} />
    </div>
  )
}

function ItemDialog({ k, item, onClose }: { k: string; item: EstimateItem | 'new' | null; onClose: () => void }) {
  const d = useData()
  const it = item && item !== 'new' ? item : null
  const [f, setF] = useState({ description: '', category: 'Other', amount: '' })
  const [key, setKey] = useState<typeof item>(null)
  if (item !== key) { setKey(item); if (item) setF({ description: it?.description ?? '', category: it?.category ?? 'Other', amount: it ? String(it.amount) : '' }) }
  async function save() {
    if (!f.description.trim() || f.amount === '' || !(Number(f.amount) >= 0)) { d.toast('Enter what it is for and an amount.'); return }
    const row: Partial<EstimateItem> = { month: it?.month ?? k, description: f.description.trim(), category: f.category, amount: Number(f.amount) }
    if (it) row.id = it.id
    if (await d.upsert('estimate_items', row)) { onClose(); d.toast(`Added to the ${monthName(row.month!)} estimate`) }
  }
  return (
    <Modal open={!!item} title={`${it ? 'Edit' : 'Add'} expense · ${monthName(it?.month ?? k)}`} onClose={onClose} onSubmit={save}
      footer={it ? <ConfirmDelete label="Remove" onConfirm={async () => { if (await d.remove('estimate_items', it.id)) { onClose(); d.toast('Removed') } }} /> : undefined}>
      <Field label="What is it for?"><input required value={f.description} placeholder="e.g. Cement for Goidhoo site" onChange={x => setF({ ...f, description: x.target.value })} /></Field>
      <div className="row">
        <Field label="Category"><select value={f.category} onChange={x => setF({ ...f, category: x.target.value })}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Amount (MVR)"><input type="number" min="0" step="0.01" inputMode="decimal" required value={f.amount} onChange={x => setF({ ...f, amount: x.target.value })} /></Field>
      </div>
    </Modal>
  )
}
