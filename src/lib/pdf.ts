import { jsPDF } from 'jspdf'
import { autoTable, type UserOptions } from 'jspdf-autotable'
import { fmt, fmt0, monthName, niceDate, todayStr } from './format'
import { lineTotal, payTotals, type Estimate, type MonthSummary } from './calc'
import type { Dashboard } from './dashboard'
import { CATEGORIES, type PayLine, type Project, type Staff } from './types'
import type { ProjectCost } from './projects'

type RGB = [number, number, number]
const NAVY: RGB = [27, 55, 102], ORANGE: RGB = [233, 84, 31], GREY: RGB = [93, 102, 120], INK: RGB = [20, 24, 32], SOFT: RGB = [238, 241, 247]
const base = { font: 'helvetica', fontSize: 9.5, cellPadding: 2.3, textColor: INK }
const head = { fillColor: NAVY, textColor: 255, fontStyle: 'bold' as const }
const footSoft = { fillColor: SOFT, textColor: INK, fontStyle: 'bold' as const }
const W = 210, M = 16

let logoData: string | null = null
async function logo() {
  if (logoData) return logoData
  try {
    const blob = await (await fetch('/logo-mark.png')).blob()
    logoData = await new Promise<string>(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result)); fr.readAsDataURL(blob) })
  } catch { logoData = null }
  return logoData
}

type Page = { doc: jsPDF; y: number }

async function start(title: string, subtitle: string): Promise<Page> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  let y = 16
  const img = await logo()
  if (img) { try { doc.addImage(img, 'PNG', M, y - 4, 20, 20) } catch { /* logo is optional */ } }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(...NAVY); doc.text('MAAVEL MALDIVES PVT LTD', M + 27, y + 4)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...ORANGE); doc.text('MAAVEL BUILDING SOLUTIONS', M + 27, y + 9.5)
  doc.setTextColor(...GREY); doc.setFontSize(9); doc.text(`Generated ${niceDate(todayStr)}`, W - M, y + 4, { align: 'right' })
  y += 20; doc.setDrawColor(...ORANGE); doc.setLineWidth(0.6); doc.line(M, y, W - M, y); y += 9
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text(title, M, y); y += 6.5
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...GREY); doc.text(subtitle, M, y); y += 5
  return { doc, y }
}

function table(p: Page, opts: UserOptions) {
  autoTable(p.doc, { startY: p.y + 2, margin: { left: M, right: M }, styles: base, headStyles: head, theme: 'grid', ...opts })
  p.y = (p.doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8
}

function section(p: Page, label: string) {
  if (p.y > 255) { p.doc.addPage(); p.y = 20 }
  p.doc.setFont('helvetica', 'bold'); p.doc.setFontSize(11.5); p.doc.setTextColor(...NAVY); p.doc.text(label, M, p.y)
}

function finish(p: Page, left: string, right: string, footer: string, filename: string) {
  const d = p.doc
  if (p.y > 245) { d.addPage(); p.y = 30 } else p.y += 12
  d.setDrawColor(150); d.setLineWidth(0.3); d.setFont('helvetica', 'normal'); d.setFontSize(9.5); d.setTextColor(...GREY)
  d.line(M, p.y, M + 70, p.y); d.line(W - M - 70, p.y, W - M, p.y)
  d.text(left, M, p.y + 5); d.text(right, W - M - 70, p.y + 5)
  const n = d.getNumberOfPages()
  for (let i = 1; i <= n; i++) {
    d.setPage(i); d.setFontSize(8.5); d.setTextColor(...GREY)
    d.text(`Maavel Maldives Pvt Ltd · ${footer} · Page ${i} of ${n}`, W / 2, 290, { align: 'center' })
  }
  d.save(filename)
}

export async function expensePdf(c: MonthSummary) {
  const p = await start(`Monthly expense report: ${monthName(c.k)}`,
    `Total spend MVR ${fmt(c.total)}  ·  Bills & expenses MVR ${fmt(c.paidTotal)}  ·  Salaries & allowances MVR ${fmt(c.salPaid)}`)
  const byCat: Record<string, number> = {}
  c.mp.forEach(x => { byCat[x.category || 'Other'] = (byCat[x.category || 'Other'] || 0) + Number(x.amount) })
  const rows: string[][] = (CATEGORIES as readonly string[]).filter(k => byCat[k]).map(k => [k, fmt(byCat[k])])
  Object.keys(byCat).filter(k => !(CATEGORIES as readonly string[]).includes(k)).forEach(k => rows.push([k, fmt(byCat[k])]))
  const np = c.pr.paid ? '' : ' (not paid)'
  rows.push([`Salaries${np}`, fmt(c.pr.paid ? c.pr.sal : 0)], [`Food allowance${np}`, fmt(c.pr.paid ? c.pr.food : 0)], [`Phone & other allowances${np}`, fmt(c.pr.paid ? c.pr.allow : 0)])
  table(p, { head: [['Summary by category', 'Amount (MVR)']], body: rows, foot: [['Total', `MVR ${fmt(c.total)}`]], footStyles: footSoft, columnStyles: { 1: { halign: 'right' } } })
  section(p, 'Payments made')
  const det = [...c.mp].sort((a, b) => a.date.localeCompare(b.date)).map(x => [niceDate(x.date), x.description, x.category, x.method, x.ref, fmt(x.amount)])
  table(p, { head: [['Date', 'Item', 'Category', 'Method', 'Ref.', 'MVR']], body: det.length ? det : [['', 'No payments recorded this month', '', '', '', '']], theme: 'striped', alternateRowStyles: { fillColor: [246, 247, 250] }, columnStyles: { 0: { cellWidth: 24 }, 5: { halign: 'right', cellWidth: 26 } } })
  if (c.unpaid.length) {
    section(p, 'Bills not yet paid')
    table(p, { head: [['Bill', 'Due', 'Status', 'MVR']], body: c.unpaid.map(r => [r.bill.name, niceDate(r.due), r.status.label, r.bill.amount == null ? 'Varies' : fmt(r.bill.amount)]), headStyles: { ...head, fillColor: ORANGE }, columnStyles: { 3: { halign: 'right', cellWidth: 26 } } })
  }
  finish(p, 'Prepared by', 'Approved by (Director)', `Expense report ${monthName(c.k)}`, `Maavel-expenses-${c.k}.pdf`)
}

export async function salarySheetPdf(k: string, lines: PayLine[], staff: Staff[]) {
  const t = payTotals(lines)
  const p = await start(`Salary sheet: ${monthName(k)}`,
    `${t.count} staff  ·  Salaries MVR ${fmt(t.sal)}  ·  Food MVR ${fmt(t.food)}  ·  Allowances MVR ${fmt(t.allow)}  ·  Total MVR ${fmt(t.total)}`)
  const passport = Object.fromEntries(staff.map(s => [s.id, s.passport_no]))
  const sum = (f: (l: PayLine) => number) => fmt0(lines.reduce((a, l) => a + f(l), 0))
  table(p, {
    head: [['#', 'Name', 'Designation', 'Passport', 'Basic', 'Extra', 'Deduct.', 'Food', 'Allow.', 'Net pay']],
    body: lines.map((l, i) => [String(i + 1), l.name, l.designation, passport[l.staffId] || '', fmt0(l.basic), l.extra ? fmt0(l.extra) : '', l.deduction ? fmt0(l.deduction) : '', fmt0(l.food), l.allowance ? fmt0(l.allowance) : '', fmt0(lineTotal(l))]),
    foot: [['', 'Total', '', '', sum(l => l.basic), sum(l => l.extra), sum(l => l.deduction), fmt0(t.food), fmt0(t.allow), fmt0(t.total)]],
    styles: { ...base, fontSize: 8.2, cellPadding: 1.8 }, footStyles: footSoft,
    columnStyles: { 0: { cellWidth: 7 }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'right', fontStyle: 'bold' } },
  })
  finish(p, 'Prepared by (HR)', 'Approved by (Director)', `Salary sheet ${monthName(k)}`, `Maavel-salary-sheet-${k}.pdf`)
}

export async function estimatePdf(e: Estimate) {
  const p = await start(`Overhead estimate: ${monthName(e.k)}`, `Estimated total MVR ${fmt(e.total)}  ·  Prepared ${niceDate(todayStr)} for the Maavel team`)
  const sum: string[][] = [[`Salaries (${e.st.length} staff)`, fmt(e.staffBasic)], ['Food allowance', fmt(e.staffFood)], ['Phone & other allowances', fmt(e.staffAllow)], ['Rent and bills', fmt(e.billsTotal)]]
  if (e.extras.length) sum.push(['Additional expenses', fmt(e.extrasTotal)])
  if (e.useOther) sum.push(['Other expenses (average of last 3 months)', fmt(e.otherAvg)])
  if (e.cont) sum.push([`Contingency ${e.cont}%`, fmt(e.contAmt)])
  table(p, { head: [['Summary', 'Estimate (MVR)']], body: sum, foot: [['Estimated total', `MVR ${fmt(e.total)}`]], footStyles: { fillColor: ORANGE, textColor: 255, fontStyle: 'bold' }, columnStyles: { 1: { halign: 'right' } } })
  if (e.extras.length) {
    section(p, 'Additional expenses')
    table(p, { head: [['Item', 'Category', 'MVR']], body: e.extras.map(x => [x.description, x.category, fmt(x.amount)]), foot: [['Total', '', fmt(e.extrasTotal)]], footStyles: footSoft, columnStyles: { 2: { halign: 'right' } } })
  }
  section(p, 'Rent and bills')
  table(p, { head: [['Bill', 'Category', 'Due', 'Basis', 'MVR']], body: e.billRows.map(r => [r.name, r.category, `Day ${r.due}`, r.basis, r.amount ? fmt(r.amount) : '–']), columnStyles: { 4: { halign: 'right' } } })
  section(p, 'Staff costs')
  table(p, {
    head: [['Name', 'Designation', 'Basic', 'Food', 'Other allow.', 'Total']],
    body: e.st.map(s => [s.name, s.designation, fmt0(s.basic), fmt0(s.food), s.allow ? fmt0(s.allow) : '', fmt0(s.basic + s.food + s.allow)]),
    foot: [['Total', '', fmt0(e.staffBasic), fmt0(e.staffFood), fmt0(e.staffAllow), fmt0(e.staffBasic + e.staffFood + e.staffAllow)]],
    footStyles: footSoft, styles: { ...base, fontSize: 8.6, cellPadding: 1.9 }, theme: 'striped', alternateRowStyles: { fillColor: [246, 247, 250] },
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
  })
  if (e.renew.length) {
    section(p, 'Staff documents to renew (fees not included above)')
    table(p, { head: [['Name', 'Document', 'Expires']], body: e.renew.map(r => [r.name, r.doc, niceDate(r.date)]), headStyles: { ...head, fillColor: ORANGE } })
  }
  finish(p, 'Prepared by', 'Approved by (Director)', `Overhead estimate ${monthName(e.k)}`, `Maavel-overhead-estimate-${e.k}.pdf`)
}

export async function directorPdf(x: Dashboard) {
  const p = await start(`Director's summary: ${monthName(x.k)}`,
    `${x.active.length} active staff  ·  Spent this month MVR ${fmt(x.cur.total)}  ·  ${monthName(x.nextK)} estimate MVR ${fmt(x.next.total)}`)
  table(p, {
    head: [['Key figures', 'MVR']],
    body: [
      [`Paid so far in ${monthName(x.k)}`, fmt(x.cur.total)],
      [`Still to pay in ${monthName(x.k)}`, fmt(x.cur.dueTotal)],
      ['Average monthly spend (last 3 full months)', fmt(x.avg3)],
      [`${monthName(x.nextK)} overhead estimate`, fmt(x.next.total)],
      [`Monthly staff cost (${x.active.length} active, ${x.expats.length} expat)`, fmt(x.staffMonthly)],
      [`Spent in ${x.year} so far`, fmt(x.ytdTotal)],
    ],
    columnStyles: { 1: { halign: 'right' } },
  })
  if (x.alerts.length) {
    section(p, 'Needs attention')
    table(p, { head: [['', 'Item', 'Details']], body: x.alerts.map(a => [a.level === 'bad' ? 'Urgent' : 'Soon', a.title, a.detail]), headStyles: { ...head, fillColor: ORANGE }, columnStyles: { 0: { cellWidth: 18 }, 1: { cellWidth: 62 } } })
  }
  section(p, 'Monthly spend, last 12 months')
  table(p, {
    head: [['Month', 'Staff', 'Rent & bills', 'Other', 'Total']],
    body: x.trend.map(t => [monthName(t.k), fmt0(t.staff), fmt0(t.bills), fmt0(t.other), fmt0(t.total)]),
    styles: { ...base, fontSize: 8.8, cellPadding: 1.8 }, theme: 'striped', alternateRowStyles: { fillColor: [246, 247, 250] },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right', fontStyle: 'bold' } },
  })
  if (x.ytdRows.length) {
    section(p, `${x.year} by category`)
    table(p, { head: [['Category', 'MVR', 'Share']], body: x.ytdRows.map(([c, v]) => [c, fmt(v), `${Math.round((v / (x.ytdTotal || 1)) * 100)}%`]), foot: [['Total', fmt(x.ytdTotal), '']], footStyles: footSoft, columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } } })
  }
  section(p, 'Staff documents to renew (next 90 days)')
  table(p, { head: [['Name', 'Document', 'Expires', 'Status']], body: x.staffDocs.length ? x.staffDocs.map(r => [r.staff.name, r.doc, niceDate(r.date), r.text]) : [['None', '', '', '']], headStyles: { ...head, fillColor: ORANGE } })
  if (x.missingDates.length) {
    section(p, 'Expats with missing passport, work permit or visa dates')
    table(p, { head: [['Name', 'Missing']], body: x.missingDates.map(s => [s.name, [!s.passport_exp && 'Passport', !s.wp_exp && 'Work permit', !s.visa_exp && 'Visa'].filter(Boolean).join(', ')]) })
  }
  if (x.companyDocs.length) {
    section(p, 'Company licences and documents')
    table(p, { head: [['Document', 'Number', 'Expires', 'Status', 'Fee']], body: x.companyDocs.map(c => [c.doc.name, c.doc.number, c.doc.expiry_date ? niceDate(c.doc.expiry_date) : 'Does not expire', c.doc.expiry_date ? (c.level === 'ok' ? 'OK' : c.text) : '', c.doc.renewal_cost ? fmt0(c.doc.renewal_cost) : '']), columnStyles: { 4: { halign: 'right' } } })
  }
  if (x.open.length) {
    section(p, 'Open to-dos')
    table(p, { head: [['To-do', 'For', 'Due', 'Priority']], body: x.open.map(t => [t.title, t.owner, t.due_date ? niceDate(t.due_date) : '', t.priority]) })
  }
  finish(p, 'Prepared by', 'Managing Director', `Director's summary ${monthName(x.k)}`, `Maavel-director-summary-${x.k}.pdf`)
}

export async function projectPdf(pr: Project, c: ProjectCost, team: Staff[]) {
  const dates = pr.start_date ? `${niceDate(pr.start_date)} – ${pr.end_date ? niceDate(pr.end_date) : 'ongoing'}` : ''
  const p = await start(`Project cost report: ${pr.name}`,
    [pr.client && `Client: ${pr.client}`, pr.location, dates, pr.status].filter(Boolean).join('  ·  '))
  const body: string[][] = [['Expenses tagged to the project', fmt(c.expenses)], ['Salaries and allowances of staff on site', fmt(c.staff)]]
  const foot: string[][] = [['Total spent to date', `MVR ${fmt(c.total)}`]]
  if (pr.contract_value) body.push(['Contract value', fmt(pr.contract_value)])
  if (pr.budget) body.push(['Cost budget', fmt(pr.budget)])
  if (c.limit) foot.push([`Left of ${pr.budget ? 'budget' : 'contract value'} (${c.pct}% used)`, `MVR ${fmt(c.limit - c.total)}`])
  table(p, { head: [['Summary', 'MVR']], body, foot, footStyles: footSoft, columnStyles: { 1: { halign: 'right' } } })
  if (c.months.length) {
    section(p, 'Spend by month')
    table(p, { head: [['Month', 'Expenses', 'Salaries', 'Total']], body: c.months.map(([k, e, s]) => [monthName(k), fmt0(e), fmt0(s), fmt0(e + s)]),
      theme: 'striped', alternateRowStyles: { fillColor: [246, 247, 250] }, columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right', fontStyle: 'bold' } } })
  }
  if (c.byCategory.length) {
    section(p, 'Expenses by category')
    table(p, { head: [['Category', 'MVR']], body: c.byCategory.map(([k, v]) => [k, fmt(v)]), columnStyles: { 1: { halign: 'right' } } })
  }
  section(p, 'Expenses')
  table(p, { head: [['Date', 'Item', 'Category', 'Ref.', 'MVR']], body: c.payments.length ? [...c.payments].reverse().map(x => [niceDate(x.date), x.description, x.category, x.ref, fmt(x.amount)]) : [['', 'No expenses tagged yet', '', '', '']],
    theme: 'striped', alternateRowStyles: { fillColor: [246, 247, 250] }, columnStyles: { 0: { cellWidth: 24 }, 4: { halign: 'right', cellWidth: 26 } } })
  if (team.length) {
    section(p, 'Staff on this site now')
    table(p, { head: [['Name', 'Job', 'Monthly cost (MVR)']], body: team.map(s => [s.name, s.designation, fmt0(Number(s.basic) + Number(s.food) + Number(s.allowance))]), columnStyles: { 2: { halign: 'right' } } })
  }
  finish(p, 'Prepared by', 'Managing Director', `Project ${pr.name}`, `Maavel-project-${pr.name.replace(/[^\w]+/g, '-')}.pdf`)
}
