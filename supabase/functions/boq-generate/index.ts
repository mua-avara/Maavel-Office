// Maavel Office: AI quantity takeoff and pricing for a Bill of Quantities.
// Deploy in Supabase: Edge Functions -> Deploy a new function -> Via editor, name it "boq-generate",
// paste this file, keep "Verify JWT" on, Deploy. It uses the same ANTHROPIC_API_KEY secret as scan-document.
// Actions: "takeoff" (one PDF chunk or one CAD summary -> measured items) and "price" (merge + rates).
// Nothing from the drawings is logged. Errors report only their kind, never their text.
import Anthropic from 'npm:@anthropic-ai/sdk'
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } })

function secretKey(): string {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (legacy) return legacy
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}')
    return keys.default ?? Object.values(keys)[0] ?? ''
  } catch { return '' }
}
const redact = (t: string) => t.replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-[hidden]').slice(0, 300)

const SECTIONS = ['Preliminaries', 'Substructure', 'Concrete & frame', 'Masonry', 'Roofing', 'Doors & windows', 'Finishes', 'Plumbing', 'Electrical', 'External works', 'Other']
const UNITS = ['m', 'm2', 'm3', 'nos', 'kg', 'item', 'lot']
const text = { type: 'string' }
const textOrNull = { anyOf: [{ type: 'string' }, { type: 'null' }] }
const numOrNull = { anyOf: [{ type: 'number' }, { type: 'null' }] }
const obj = (props: Record<string, unknown>) => ({ type: 'object', properties: props, required: Object.keys(props), additionalProperties: false })

const ITEM = {
  section: { type: 'string', enum: SECTIONS }, description: text, unit: { type: 'string', enum: UNITS }, qty: { type: 'number' },
  basis: text, confidence: { type: 'string', enum: ['high', 'medium', 'low'] }, sheet: text,
}
const TAKEOFF_SCHEMA = obj({ items: { type: 'array', items: obj(ITEM) }, assumptions: { type: 'array', items: text } })
const PRICE_SCHEMA = obj({
  items: { type: 'array', items: obj({ ...ITEM, rate_code: textOrNull, suggested_rate: numOrNull, rate_note: text }) },
  checks: { type: 'array', items: text },
})

const ESTIMATOR = `You are a senior quantity surveyor preparing a Bill of Quantities for a construction company in the Maldives (currency MVR, metric units).
Method:
- Measure net quantities from the drawings (no waste added; waste and laps belong in the rates). Deduct openings over 0.5 m2 from wall areas.
- Use these trade sections only: ${SECTIONS.join(', ')}.
- Units: m (linear), m2 (area), m3 (volume), nos (counted items), kg (reinforcement), item / lot (lump sums).
- Describe items the way a Maldivian BOQ would, e.g. "150 mm hollow concrete blockwork in cement mortar 1:6", "Reinforced concrete grade C25 in suspended slab".
- Typical items: excavation, backfill, blinding, RC footings, columns, beams and slabs, reinforcement (if not scheduled, allow about 100-120 kg/m3 for slabs and beams, 150-180 kg/m3 for columns, 80 kg/m3 for footings, and say so), formwork, blockwork, plaster both faces, paint, floor and wall tiles, ceilings, roofing, doors and windows by type, sanitary fixtures, lighting and power points, external works.
- For every item give the basis: the numbers used, e.g. "external walls 36.0 m x 3.2 m x 1 floor - 6 openings 9.4 m2".
- confidence: high when measured directly from dimensions; medium when derived with stated assumptions; low when estimated without clear information.
- Never invent things the drawings do not show; if something important is missing (e.g. no structural drawings), add it as a low-confidence item with the allowance used, and list it in assumptions.`

const IMAGE_SIZE_LIMIT = 30 * 1024 * 1024

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply({ error: 'Use POST.' }, 405)

  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', secretKey(), { auth: { persistSession: false, autoRefreshToken: false } })
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: who, error: whoErr } = await admin.auth.getUser(token)
  if (whoErr || !who.user) return reply({ error: 'Please sign in again.' }, 401)
  const { data: me } = await admin.from('profiles').select('role').eq('id', who.user.id).maybeSingle()
  if (me?.role !== 'admin' && me?.role !== 'editor') return reply({ error: 'Only admins and editors can make BOQs.' }, 403)

  const apiKey = (Deno.env.get('ANTHROPIC_API_KEY') ?? '').match(/sk-ant-[A-Za-z0-9_-]+/)?.[0]
  if (!apiKey) return reply({ error: 'The AI is not set up yet: add the ANTHROPIC_API_KEY secret in Supabase.' }, 500)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return reply({ error: 'Bad request.' }, 400) }
  const a = (body.assumptions ?? {}) as Record<string, unknown>
  const assumptions = `Project assumptions given by the user: ${a.floors ?? 1} floor(s); floor-to-floor height ${a.floorHeight ?? 3.2} m; walls ${a.blockMm ?? 150} mm hollow concrete blocks; slabs ${a.slabMm ?? 150} mm; finishes ${a.finishes ?? 'standard'}; ${a.includeMep === false ? 'exclude plumbing and electrical' : 'include plumbing and electrical'}.${a.notes ? ` Notes: ${String(a.notes).slice(0, 500)}` : ''}`

  const client = new Anthropic({ apiKey })
  const ask = async (content: Anthropic.Beta.BetaContentBlockParam[], schema: object, effort: 'low' | 'medium') => {
    const response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort, format: { type: 'json_schema', schema } },
      system: ESTIMATOR,
      messages: [{ role: 'user', content }],
    })
    if (response.stop_reason === 'refusal') throw new Error('REFUSED')
    if (response.stop_reason === 'max_tokens') throw new Error('TOO_LONG')
    const block = response.content.find(b => b.type === 'text')
    if (!block || block.type !== 'text') throw new Error('EMPTY')
    return JSON.parse(block.text)
  }

  try {
    if (body.action === 'takeoff') {
      const label = String(body.label ?? 'drawing').slice(0, 120)
      if (body.kind === 'pdf') {
        const data = String(body.data ?? '')
        if (!data) return reply({ error: 'No drawing received.' }, 400)
        if (data.length * 0.75 > IMAGE_SIZE_LIMIT) return reply({ error: 'This part of the drawing set is too large. Try a smaller PDF.' }, 400)
        const out = await ask([
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } },
          { type: 'text', text: `${assumptions}\nThese are sheets ${label} of the drawing set. Take off every measurable item shown on these sheets. Use the sheet number or title as "sheet".` },
        ], TAKEOFF_SCHEMA, 'medium')
        return reply({ ok: true, ...out })
      }
      if (body.kind === 'cad') {
        const summary = JSON.stringify(body.summary ?? {}).slice(0, 120000)
        const out = await ask([{ type: 'text', text: `${assumptions}
This is a measured summary of the CAD drawing "${label}" (lengths, areas and counts per layer, block counts, and text found in the drawing).
How to read it: wall layers are usually drawn as two parallel lines, so the wall centreline length is about half of open_length_m on a wall layer (or use closed_perimeter_m of wall outlines). Closed shapes on room, floor, slab or area layers are floor areas. Block names and their layers usually identify doors, windows, columns and sanitary fixtures; count them. Text gives room names and sizes. Layer names are often like A-WALL, WALL, DOOR, WIN, COL, BEAM, SLAB, FURN.
If the summary has "notes", follow them: they say when the sheet was scaled from paper size or when layer names cannot be trusted.
Take off every measurable item, explaining in "basis" which layer and numbers you used. Use the file name as "sheet".
${summary}` }], TAKEOFF_SCHEMA, 'medium')
        return reply({ ok: true, ...out })
      }
      return reply({ error: 'Unknown drawing type.' }, 400)
    }

    if (body.action === 'price') {
      const items = JSON.stringify(body.items ?? []).slice(0, 200000)
      const rates = JSON.stringify(body.rates ?? []).slice(0, 60000)
      const out = await ask([{ type: 'text', text: `${assumptions}
Below are takeoff items from several sheets of one project, and Maavel's own rate list.
1. Merge duplicates (the same work measured on more than one sheet), keeping the best-supported quantity and combining the basis. Do not double count. Order by section.
2. For each item, if a rate in Maavel's list matches the work and unit, set rate_code to that code and suggested_rate to null.
3. If no listed rate matches, or the listed rate is empty (null), set suggested_rate to a realistic current Maldives market rate in MVR for supply and fix (labour, materials, plant, waste; excluding overhead and profit) and say in rate_note what it is based on, briefly. If you cannot judge a rate, leave suggested_rate null.
4. In "checks", list any cross-checks that look wrong (e.g. concrete m3 per floor m2, plaster area vs blockwork area, missing trades).
TAKEOFF ITEMS: ${items}
MAAVEL RATE LIST: ${rates}` }], PRICE_SCHEMA, 'low')
      return reply({ ok: true, ...out })
    }

    return reply({ error: 'Unknown action.' }, 400)
  } catch (e) {
    if (e instanceof Error && e.message === 'REFUSED') return reply({ error: 'This drawing could not be processed automatically.' }, 422)
    if (e instanceof Error && e.message === 'TOO_LONG') return reply({ error: 'The answer was too long. Try fewer sheets at a time.' }, 422)
    if (e instanceof Anthropic.AuthenticationError) return reply({ error: 'The Anthropic API key in Supabase is not valid.' }, 500)
    if (e instanceof Anthropic.RateLimitError) return reply({ error: 'Too many requests at once. Wait a minute and try again.' }, 429)
    if (e instanceof Anthropic.BadRequestError) { console.error('boq-generate bad request:', redact(String(e.message))); return reply({ error: 'The drawing could not be read. Try a smaller or clearer PDF.' }, 400) }
    if (e instanceof Anthropic.APIError) { console.error('boq-generate API error:', e.status, redact(String(e.message))); return reply({ error: `The AI service had a problem (${e.status}). Try again.` }, 502) }
    console.error('boq-generate failed:', redact(e instanceof Error ? `${e.name}: ${e.message}` : String(e)))
    return reply({ error: 'Something went wrong making the BOQ. Try again.', detail: e instanceof Error ? e.name : 'Error' }, 500)
  }
})
