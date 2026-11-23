import { useEffect, useState } from 'react'
import { useData } from '../data/DataContext'
import { lineTotal, linesFromStaff, payTotals, payrollInfo } from '../lib/calc'
import { fmt, fmt0, monthName, niceDate, todayStr } from '../lib/format'
import type { PayLine, PayrollMonth } from '../lib/types'
import { Empty, Section, Tile } from '../components/ui'

export default function PayrollView({ k }: { k: string }) {
  const d = useData()
  const pm = d.payroll_months.find(p => p.month === k)
  const pr = payrollInfo(pm)
  const [draft, setDraft] = useState<PayLine[] | null>(null)
  const [armed, setArmed] = useState(false)

  // Start from the saved lines whenever the month (or the saved payroll) changes.
  const [seen, setSeen] = useState<{ k: string; pm: PayrollMonth | undefined } | null>(null)
  if (!seen || seen.k !== k || seen.pm !== pm) {
    setSeen({ k, pm })
    setDraft(pm?.lines?.length ? pm.lines.map(l => ({ ...l })) : null)
  }
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 4000); return () => clearTimeout(t) }, [armed])

  const mode: 'lines' | 'totals' | 'new' = draft ? 'lines' : pr.source === 'totals' ? 'totals' : 'new'
  const lines = draft ?? (mode === 'new' ? linesFromStaff(d.staff, k) : [])
  const t = mode === 'totals' ? pr : payTotals(lines)
  const paid = pr.source === 'lines' ? pr.paid : pr.source === 'totals'
  const lock = !d.canEdit || mode === 'totals'

  function change(i: number, field: 'extra' | 'deduction', v: string) {
    const base = draft ?? linesFromStaff(d.staff, k)
    setDraft(base.map((l, j) => (j === i ? { ...l, [field]: Number(v) || 0 } : l)))
  }

  async function save(markPaid: boolean) {
    const ls = draft ?? linesFromStaff(d.staff, k)
    const tt = payTotals(ls)
    const row: Partial<PayrollMonth> = {
      month: k, lines: ls, salaries: tt.sal, food: tt.food, allowances: tt.allow, staff_count: tt.count,
      pay_status: markPaid || pm?.pay_status === 'paid' ? 'paid' : 'draft',
      paid_date: markPaid ? todayStr : pm?.paid_date ?? null, source: 'app',
    }
    if (await d.upsert('payroll_months', row)) d.toast(markPaid ? `Payroll marked paid for ${monthName(k)}` : 'Payroll saved')
  }

  return (
    <div className="view">
      <div className="tiles">
        <Tile label="Salaries" value={fmt0(t.sal)} sub="Basic + extra − deductions" />
        <Tile label="Food & allowances" value={fmt0(t.food + t.allow)} sub="Food, phone and other" />
        <Tile label="People paid" value={t.count ?? '–'} />
        <Tile label="Total payroll" value={fmt0(t.total)} total
          sub={mode === 'totals' ? 'Recorded from salary sheet' : paid ? `Paid${pr.paidDate ? ` ${niceDate(pr.paidDate)}` : ''}` : mode === 'new' ? 'Draft from staff list' : 'Saved, not paid yet'} />
      </div>
      <Section title={`Payroll · ${monthName(k)}`}
        intro={mode === 'totals' ? 'Only the month’s totals were recorded. Tap Rebuild from staff list to see everyone, with today’s staff and pay.'
          : paid ? 'This payroll is marked paid. You can still correct an amount and save.'
          : 'Built from the active staff list. Add overtime or deductions, then mark it paid once salaries go out.'}
        action={<div className="toolbar">
          {mode !== 'new' && <button disabled={!d.canEdit} onClick={() => { setDraft(linesFromStaff(d.staff, k)); d.toast('Rebuilt from today’s staff list. Save to keep it.') }}>Rebuild from staff list</button>}
          <button onClick={() => mode === 'totals' ? d.toast('This month has only totals. Rebuild from staff list first.') : import('../lib/pdf').then(m => m.salarySheetPdf(k, lines, d.staff))}>Salary sheet PDF</button>
        </div>}>
        <div className="tablewrap"><table>
          <thead><tr><th>Name</th><th className="num">Basic</th><th className="num">Extra / OT</th><th className="num">Deductions</th><th className="num">Food</th><th className="num">Allow.</th><th className="num">Net pay</th></tr></thead>
          <tbody>
            {mode === 'totals' ? <Empty cols={7}>Salaries MVR {fmt(pr.sal)} · Food MVR {fmt(pr.food)}{pr.allow ? ` · Allowances MVR ${fmt(pr.allow)}` : ''}{pr.count ? ` · ${pr.count} people` : ''}</Empty>
              : !lines.length ? <Empty cols={7}>No active staff for this month.</Empty>
              : lines.map((l, i) => (
                <tr key={l.staffId}>
                  <td className="name">{l.name}<span className="sub">{l.designation}</span></td>
                  <td className="num">{fmt0(l.basic)}</td>
                  <td className="num"><input className="cell" type="number" min="0" disabled={lock} aria-label={`Extra for ${l.name}`} value={l.extra || ''} onChange={e => change(i, 'extra', e.target.value)} /></td>
                  <td className="num"><input className="cell" type="number" min="0" disabled={lock} aria-label={`Deductions for ${l.name}`} value={l.deduction || ''} onChange={e => change(i, 'deduction', e.target.value)} /></td>
                  <td className="num">{fmt0(l.food)}</td>
                  <td className="num">{l.allowance ? fmt0(l.allowance) : ''}</td>
                  <td className="num"><strong>{fmt0(lineTotal(l))}</strong></td>
                </tr>
              ))}
          </tbody>
        </table></div>
        <div className="toolbar"><div className="grow" />
          <button disabled={lock} onClick={() => save(false)}>Save changes</button>
          <button className="primary" disabled={lock || paid} onClick={() => (armed ? (setArmed(false), save(true)) : setArmed(true))}>
            {paid ? 'Payroll paid' : armed ? 'Tap again to confirm' : 'Mark payroll paid'}
          </button>
        </div>
      </Section>
    </div>
  )
}
