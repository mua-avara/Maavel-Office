# Maavel Office

Internal web app for **Maavel Maldives Pvt Ltd** (construction company, Maldives): staff, payroll, rent/bills, other expenses and next-month overhead estimates, with PDF reports. Users are the company's partners and HR manager, often on phones.

## Stack
- React 19 + TypeScript + Vite (`npm run dev`, `npm run build`, `npx oxlint`)
- Supabase: Postgres + auth (email link or password, invite-only) + realtime. Client in `src/lib/supabase.ts`, env vars `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` in `.env.local` (never commit it).
- Hosting: Cloudflare Pages, build `npm run build`, output `dist`, `NODE_VERSION=22`.
- PDFs: jsPDF + jspdf-autotable, loaded lazily from `src/lib/pdf.ts`.

## Where things are
- `src/App.tsx` sign-in gate and routing (hash routes `#home #month #staff #payroll #estimate #projects #assets #company #team` (`#home` = director dashboard, the default); `#staff/<id>`, `#projects/<id>` and `#assets/<id>` open a profile, project or vehicle page; `#staff/new`, `#projects/new`, `#assets/new-vehicle`, `#assets/new-machine`, `#month/expense` open the add form once (Overview quick actions))
- `src/components/Shell.tsx` layout: collapsible left sidebar (phone: slide-out drawer + bottom bar), top bar with month picker, search (`/`), notifications (dashboard alerts, read state per device) and light/dark switch (`src/lib/theme.ts`, saved in localStorage); `src/components/icons.tsx` inline SVG icons
- `src/data/DataContext.tsx` loads every table, subscribes to realtime, `upsert`/`remove`/`toast`
- `src/lib/calc.ts` business rules: payroll lines and totals, bill status, document expiry alerts, overhead estimate
- `src/lib/types.ts` row types (snake_case, same as the database), categories, payment methods
- `src/lib/dashboard.ts` director dashboard: alerts, next-30-days list, 12-month trend, renewals (staff and company documents warn at 60 days, urgent at 30)
- `src/views/*` one file per tab; `src/components/ui.tsx` shared Modal, Tile, Pill, Section
- Vehicles & equipment: `assets` table (kind vehicle/machinery, registry fields, `annual_fee_due`, `insurance_exp`, `roadworthy_exp` labelled Road worthiness / Survey (vessels) / Inspection (machinery) via `src/lib/assets.ts`, optional `project_id`); `src/views/AssetsView.tsx`; renewals feed dashboard alerts, Next 30 days and the director PDF.
- `company_docs`, `tasks`, `files`, `leaves`, `projects` and `assets` tables are optional in the app (`OPTIONAL` in DataContext): if the SQL hasn't been run, those sections show a setup note instead of failing. New staff/payment columns are only written when `projects` exists.
- Files: private Storage bucket `files`, path `owner_type/owner_id/uuid-name`, a row in `files` per upload. `src/lib/files.ts` (upload with image shrinking, signed URLs, delete), `src/components/Files.tsx` (list/upload UI, `Photo`). Deleting a staff member, company doc or project also deletes its files.
- Logins: `supabase/functions/admin-users` Edge Function (create/set_password/remove, admin only), called from `src/lib/admin.ts` on the Team tab. Deployed by pasting into the Supabase dashboard.
- Projects: `src/lib/projects.ts` `projectCost` = payments with `project_id` + paid payroll lines with `projectId` (copied from `staff.project_id` when a sheet is built).
- New Supabase projects don't grant table access to API roles: every new table needs `grant select, insert, update, delete … to authenticated` in `schema.sql`.
- `supabase/schema.sql` tables, RLS, realtime publication (idempotent, safe to re-run); `supabase/seed.sql` starting data
- `src/index.css` minimal "liquid glass" theme (last section overrides the base): frosted translucent panels with a light edge over a quiet tinted backdrop, floating glass sidebar, system font, compact type (14px body); solid fallbacks when blur or transparency is off; phone layout below 900px, fields stay 16px on touch screens. Motion section at the end: page/block entrance (keyframes use `backwards` fill so hover transforms still work), growing charts, drifting backdrop, spring pop-ins; `Tile` numbers count up (`CountUp` in ui.tsx); everything off under prefers-reduced-motion. Sidebar collapses to icons from the top-bar button or `[`

## Business rules to keep
- Currency MVR. Months are `YYYY-MM` strings. Rent and most bills are due on the 10th.
- Expat staff get MVR 1,200/month food allowance (MVR 1,000 in a part first month). Ali Waheed: MVR 3,000 food + MVR 600 phone allowance. Maavel currently pays no pension.
- Payroll net = basic + extra − deductions + food + allowance. A month either has per-person `lines` (built in the app) or only totals (history imported from salary sheets, Jan–Oct 2026).
- Staff who leave are set to status `Left` with a `left_date`, not deleted, so history stays.
- Leave: 30 days annual (per staff `annual_leave_days`) and 15 days sick a year, counted per calendar year; days default to calendar days and can be edited.
- Estimate = active staff pay and allowances + active bills (fixed amount or 3-month average) + that month's `estimate_items` + optional 3-month average of other expenses + optional contingency %.
- Roles: admin (everything incl. roles), editor (data), viewer (read + PDFs). Enforced by RLS in `schema.sql`; the UI only mirrors it. First person to sign in becomes admin.

## Working on it
- Change the database by editing `supabase/schema.sql` (keep it re-runnable) and tell the user to run the changed part in the Supabase SQL Editor.
- Keep the UI plain-English and phone friendly; test at ~400px wide.
- Staff data includes passport numbers and pay: keep the repo private, never log or export it anywhere public.
- Run `npx tsc -b && npm run build && npx oxlint` before committing.
