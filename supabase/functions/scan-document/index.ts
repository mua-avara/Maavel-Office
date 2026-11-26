// Maavel Office: reads a scanned document (photo or PDF) with Claude and returns the form fields.
// Deploy in Supabase: Edge Functions -> Deploy a new function -> Via editor, name it "scan-document",
// paste this file, keep "Verify JWT" on, Deploy. Then add the secret ANTHROPIC_API_KEY
// (Edge Functions -> Secrets). The key stays in Supabase; it never reaches the browser.
// Nothing from the document is logged or stored here; the app stores the file itself in Storage.
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

// ---- what to read from each kind of document ----
const text = { anyOf: [{ type: 'string' }, { type: 'null' }] }
const date = { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] }
const num = { anyOf: [{ type: 'number' }, { type: 'null' }] }
const obj = (props: Record<string, unknown>) => ({ type: 'object', properties: props, required: Object.keys(props), additionalProperties: false })

const DOCS: Record<string, { label: string; schema: object; hint: string }> = {
  passport: {
    label: 'passport (photo/data page)',
    schema: obj({ full_name: text, passport_no: text, nationality: text, date_of_birth: date, issue_date: date, expiry_date: date }),
    hint: 'Prefer the machine-readable zone (the two lines of <<< at the bottom) for the passport number and dates, and check them against the printed fields. full_name is given names then surname, in normal capitalisation. nationality is the country name in English (e.g. "Bangladesh", not "BGD").',
  },
  national_id: {
    label: 'Maldives national identity card (front or back)',
    schema: obj({ full_name: text, id_no: text, date_of_birth: date, expiry_date: date }),
    hint: 'id_no is the ID card number, a letter followed by digits such as "A123456"; copy it with no spaces. full_name is the name in English (Latin letters), not the Dhivehi (Thaana) name, in normal capitalisation. expiry_date is the date of expiry printed on the card.',
  },
  evisa: {
    label: 'Maldives e-visa / work visa',
    schema: obj({ visa_no: text, holder_name: text, passport_no: text, nationality: text, employer: text, issue_date: date, expiry_date: date }),
    hint: 'visa_no is the visa, permit or reference number printed on the visa. expiry_date is when the visa / permission to work ends.',
  },
  vehicle_registration: {
    label: 'vehicle or vessel registration certificate',
    schema: obj({ reg_no: text, make: text, model: text, year: num, colour: text, chassis_no: text, engine_no: text, registered_owner: text, vehicle_type: text, expiry_date: date }),
    hint: 'reg_no is the number plate or vessel registration number exactly as printed (e.g. "P-1234" or "A1234A"). chassis_no may be called VIN, chassis or hull number. year is the year of manufacture.',
  },
  insurance: {
    label: 'insurance policy, card or certificate (for a vehicle, machine or a person)',
    schema: obj({ insurer: text, policy_no: text, insured_item: text, insured_name: text, reg_no: text, start_date: date, expiry_date: date }),
    hint: 'insurer is the insurance company. insured_name is the person covered (for health or work insurance); insured_item is the vehicle or machine covered. expiry_date is the end of the period of cover.',
  },
  medical: {
    label: 'medical / fitness certificate or medical report for a worker',
    schema: obj({ holder_name: text, passport_no: text, result: text, clinic: text, issue_date: date, expiry_date: date }),
    hint: 'result is the outcome such as "Fit" or "Unfit". issue_date is the examination or issue date. expiry_date is the valid-until date if printed; if the certificate only states a validity period (for example "valid for one year"), work out the expiry from the issue date; otherwise null.',
  },
  road_worthiness: {
    label: 'road worthiness, survey or inspection certificate',
    schema: obj({ reg_no: text, certificate_no: text, issue_date: date, expiry_date: date }),
    hint: 'expiry_date is when the certificate stops being valid (valid until / next inspection due).',
  },
  annual_fee: {
    label: 'annual vehicle fee / registration renewal receipt',
    schema: obj({ reg_no: text, amount_mvr: num, paid_date: date, next_due_date: date }),
    hint: 'amount_mvr is the fee paid in MVR. next_due_date is when the next annual fee is due (often one year after the period covered); null if not shown.',
  },
  licence: {
    label: 'company licence, permit or registration certificate',
    schema: obj({ document_name: text, number: text, issuer: text, issue_date: date, expiry_date: date }),
    hint: 'document_name is a short plain name such as "Business permit" or "GST registration". issuer is the government office or company that issued it.',
  },
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

/** Remove anything that looks like an API key before text goes into a log. */
const redact = (t: string) => t.replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-[hidden]').slice(0, 300)

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply({ error: 'Use POST.' }, 405)

  // Only signed-in admins and editors may scan.
  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', secretKey(), { auth: { persistSession: false, autoRefreshToken: false } })
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: who, error: whoErr } = await admin.auth.getUser(token)
  if (whoErr || !who.user) return reply({ error: 'Please sign in again.' }, 401)
  const { data: me } = await admin.from('profiles').select('role').eq('id', who.user.id).maybeSingle()
  if (me?.role !== 'admin' && me?.role !== 'editor') return reply({ error: 'Only admins and editors can scan documents.' }, 403)

  // Accept the key even if extra text was pasted around it; use only the key itself.
  const apiKey = (Deno.env.get('ANTHROPIC_API_KEY') ?? '').match(/sk-ant-[A-Za-z0-9_-]+/)?.[0]
  if (!apiKey) return reply({ error: 'Document scanning is not set up yet: add the ANTHROPIC_API_KEY secret in Supabase (just the key, starting sk-ant-).' }, 500)

  let body: { type?: string; mime?: string; data?: string }
  try { body = await req.json() } catch { return reply({ error: 'Bad request.' }, 400) }
  const doc = DOCS[String(body.type)]
  const mime = String(body.mime ?? '')
  const data = String(body.data ?? '')
  if (!doc) return reply({ error: 'Unknown document type.' }, 400)
  if (!data) return reply({ error: 'No file received.' }, 400)
  const isPdf = mime === 'application/pdf'
  if (!isPdf && !IMAGE_TYPES.includes(mime)) return reply({ error: 'Use a photo (JPG or PNG) or a PDF.' }, 400)

  const client = new Anthropic({ apiKey })
  const file = isPdf
    ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data } }
    : { type: 'image' as const, source: { type: 'base64' as const, media_type: mime as 'image/jpeg', data } }

  try {
    const response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: doc.schema } },
      system: 'You read business documents for a construction company in the Maldives and copy fields from them exactly. ' +
        'Give every date as YYYY-MM-DD. If a field is not clearly visible on the document, return null for it; never guess or invent a value. ' +
        'If the document is not the kind requested, return null for every field.',
      messages: [{
        role: 'user',
        content: [file, { type: 'text', text: `This should be a ${doc.label}. Read it and fill the fields. ${doc.hint}` }],
      }],
    })
    if (response.stop_reason === 'refusal') return reply({ error: 'This document could not be read automatically. Please fill the fields by hand.' }, 422)
    const block = response.content.find(b => b.type === 'text')
    if (!block || block.type !== 'text') return reply({ error: 'No result came back. Try a clearer photo.' }, 502)
    const fields = JSON.parse(block.text)
    const found = Object.values(fields).filter(v => v !== null && v !== '').length
    return reply({ ok: true, fields, found })
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return reply({ error: 'The Anthropic API key in Supabase is not valid. Check the ANTHROPIC_API_KEY secret.' }, 500)
    if (e instanceof Anthropic.RateLimitError) return reply({ error: 'Too many scans at once. Wait a minute and try again.' }, 429)
    if (e instanceof Anthropic.BadRequestError) return reply({ error: 'The file could not be read. Try a clearer photo or a smaller PDF.' }, 400)
    if (e instanceof Anthropic.APIError) { console.error('scan-document API error:', e.status, redact(String(e.message))); return reply({ error: `The reading service had a problem (${e.status}). Try again.` }, 502) }
    // Report only the kind of error, never its message: messages can contain request headers (the key).
    const detail = e instanceof Error ? e.name : 'Error'
    console.error('scan-document failed:', redact(e instanceof Error ? `${e.name}: ${e.message}` : String(e)))
    return reply({ error: 'Something went wrong reading the document. Try again.', detail }, 500)
  }
})
