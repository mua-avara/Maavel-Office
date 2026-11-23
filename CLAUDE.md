# Maavel Office

Internal web app for **Maavel Maldives Pvt Ltd** (construction company, Maldives): staff, payroll, rent/bills, other expenses and next-month overhead estimates, with PDF reports. Users are the company's partners and HR manager, often on phones.

## Stack
- React 19 + TypeScript + Vite (`npm run dev`, `npm run build`, `npx oxlint`)
- Supabase: Postgres + auth (email link or password, invite-only) + realtime. Client in `src/lib/supabase.ts`, env vars `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` in `.env.local` (never commit it).
- Hosting: Cloudflare Pages, build `npm run build`, output `dist`, `NODE_VERSION=22`.
- PDFs: jsPDF + jspdf-autotable, loaded lazily from `src/lib/pdf.ts`.

## Where things are
- `src/App.tsx` sign-in gate, tabs (hash routes `#month #staff #payroll #estimate #team`), month picker
- `src/data/DataContext.tsx` loads every table, subscribes to realtime, `upsert`/`remove`/`toast`
- `src/lib/calc.ts` business rules: payroll lines and totals, bill status, document expiry alerts, overhead estimate
- `src/lib/types.ts` row types (snake_case, same as the database), categories, payment methods
- `src/views/*` one file per tab; `src/components/ui.tsx` shared Modal, Tile, Pill, Section
- `supabase/schema.sql` tables, RLS, realtime publication (idempotent, safe to re-run); `supabase/seed.sql` starting data
- `src/index.css` "spatial" glass theme, light and dark, mobile first

## Business rules to keep
- Currency MVR. Months are `YYYY-MM` strings. Rent and most bills are due on the 10th.
- Expat staff get MVR 1,200/month food allowance (MVR 1,000 in a part first month). Ali Waheed: MVR 3,000 food + MVR 600 phone allowance. Maavel currently pays no pension.
- Payroll net = basic + extra − deductions + food + allowance. A month either has per-person `lines` (built in the app) or only totals (history imported from salary sheets, Jan–Oct 2026).
- Staff who leave are set to status `Left` with a `left_date`, not deleted, so history stays.
- Estimate = active staff pay and allowances + active bills (fixed amount or 3-month average) + that month's `estimate_items` + optional 3-month average of other expenses + optional contingency %.
- Roles: admin (everything incl. roles), editor (data), viewer (read + PDFs). Enforced by RLS in `schema.sql`; the UI only mirrors it. First person to sign in becomes admin.

## Working on it
- Change the database by editing `supabase/schema.sql` (keep it re-runnable) and tell the user to run the changed part in the Supabase SQL Editor.
- Keep the UI plain-English and phone friendly; test at ~400px wide.
- Staff data includes passport numbers and pay: keep the repo private, never log or export it anywhere public.
- Run `npx tsc -b && npm run build && npx oxlint` before committing.
