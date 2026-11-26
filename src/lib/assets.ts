import { expiryLevel, type Level } from './dashboard'
import { VESSEL_TYPES, type Asset } from './types'

export const isVessel = (a: Pick<Asset, 'type'>) => VESSEL_TYPES.includes(a.type)

/** The third certificate's name depends on what the asset is. */
export function checkLabel(a: Pick<Asset, 'kind' | 'type'>) {
  if (a.kind === 'machinery') return 'Inspection / certificate'
  return isVessel(a) ? 'Survey / seaworthiness' : 'Road worthiness'
}

export type AssetDoc = { key: 'annual_fee_due' | 'insurance_exp' | 'roadworthy_exp'; label: string; fileKind: string; date: string | null; level: Level | 'none'; days: number | null; text: string }

/** The renewals each asset has, with their status. Sold assets need none. */
export function assetDocs(a: Asset): AssetDoc[] {
  const rows: [AssetDoc['key'], string, string][] = [
    ['annual_fee_due', 'Annual fee', 'Annual fee receipt'],
    ['insurance_exp', 'Insurance', 'Insurance'],
    ['roadworthy_exp', checkLabel(a), 'Road worthiness'],
  ]
  return rows.map(([key, label, fileKind]) => ({ key, label, fileKind, date: a[key], ...expiryLevel(a[key]) }))
}

const RANK: Record<string, number> = { bad: 0, warn: 1, ok: 2, none: 3 }
/** The most urgent renewal, for the list pill. */
export function worstExpiry(a: Asset): AssetDoc | null {
  if (a.status === 'Sold') return null
  const dated = assetDocs(a).filter(d => d.date)
  return dated.sort((x, y) => RANK[x.level] - RANK[y.level] || (x.days ?? 0) - (y.days ?? 0))[0] ?? null
}
