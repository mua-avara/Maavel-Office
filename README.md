# Maavel Office

Staff, payroll, bills and overhead estimates for **Maavel Maldives Pvt Ltd**, with PDF reports.

- **Dashboard**: the director's view: what needs attention, the next 30 days, a to-do list, 12-month overhead trend, staff visa and document renewals, company licences, and a director's summary PDF
- **Month**: rent and bills (paid / due soon / overdue), other expenses, monthly expense PDF
- **Staff**: a profile for each person with their passport photo, passport, e-visa, work permit, medical and insurance (expiry alerts plus uploaded scans), other documents, leave balance and records, and pay history
- **Payroll**: built from the staff list each month, overtime and deductions, salary sheet PDF
- **Estimate**: next month's overheads plus any extra items, as a PDF to share with the team
- **Projects**: construction projects and sites: expenses and staff salaries per project, budget used, files, and a cost report PDF
- **Vehicles & equipment**: cars, pickups, bikes, boats, site vehicles and machinery with registry details, annual fee, insurance and road worthiness (survey / inspection) renewals, papers, photos and the site each is on
- **Company**: business registration, permits, GST, leases, insurance, vehicles and quota approvals with expiry dates, renewal fees and scans
- **Team**: add logins for partners and staff, reset passwords, remove access, and choose admin, editor or viewer

Built with React, TypeScript and Vite. Data and sign-in are on [Supabase](https://supabase.com) (free plan). Hosting is on [Cloudflare Pages](https://pages.cloudflare.com) (free). Everyone who signs in sees changes live.

---

## 1. Set up the database (Supabase, about 10 minutes)

1. Create a free account at supabase.com and a **New project** called `maavel-office`.
   Pick the region closest to the Maldives (for example Mumbai/`ap-south-1` or Singapore), set a strong database password and keep it safe.
2. In the project, open **SQL Editor → New query**. Paste all of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**.
3. Open a new query, paste [`supabase/seed.sql`](supabase/seed.sql) and click **Run**. This loads the 26 staff, 10 bills, rent payments for January to November 2026, salary totals for January to October 2026 and the December estimate item.
4. Go to **Authentication → Sign In / Providers** and turn **off** "Allow new users to sign up". Only people you invite can then get in.
5. Go to **Authentication → Users → Invite user** and invite yourself first. **The first person to sign in becomes the admin.** Invite your partners after that; they start as viewers, and you promote them on the **Team** tab.
6. Go to **Project Settings → API** (or the **Connect** button) and copy the **Project URL** and the **anon public** key. You need them in step 2.

## 2. Put it online (Cloudflare Pages, about 5 minutes)

1. Create a free account at dash.cloudflare.com → **Workers & Pages → Create → Pages → Connect to Git**, and pick this repository.
2. Build settings:
   - Framework preset: **Vite** (or "None")
   - Build command: `npm run build`
   - Build output directory: `dist`
3. Environment variables (Production and Preview):
   - `VITE_SUPABASE_URL` = your Project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon public key
   - `NODE_VERSION` = `22`
4. **Save and Deploy**. You get an address like `https://maavel-office.pages.dev`.
5. Back in Supabase, **Authentication → URL Configuration**: set **Site URL** to that address and add it under **Redirect URLs**. Invite and sign-in emails then link to the right place.

Every push to `main` redeploys automatically.

**Own web address (optional):** in Cloudflare Pages → your project → **Custom domains**, add for example `office.maavel.mv`. The domain itself is bought separately; connecting it is free. Then add it to the Supabase Redirect URLs too.

## Logins from the Team tab (one-time setup)

Admins create logins on the **Team** tab with **Add person**. This needs a small server function in Supabase, because creating logins uses the secret key, which must never be in the website:

1. Supabase → **Edge Functions** → **Deploy a new function** → **Via editor**.
2. Name it `admin-users`, replace the sample code with everything in `supabase/functions/admin-users/index.ts`, keep **Verify JWT** on, and click **Deploy**.

## Scan to fill (one-time setup)

Forms for staff, vehicles and company documents have a **Scan a document** box: photograph or upload a passport, e-visa, registration card, insurance, certificate or receipt and the fields fill in for you to check before saving. It uses Claude (Anthropic) through a small server function:

1. Create an API key at platform.claude.com (organization: Maavel Maldives Pvt Ltd), expiry *Never*.
2. Supabase → **Edge Functions → Secrets**: add `ANTHROPIC_API_KEY` with just the key (`sk-ant-…`).
3. Supabase → **Edge Functions → Deploy a new function → Via editor**, name `scan-document`, paste `supabase/functions/scan-document/index.ts`, keep **Verify JWT** on.

Each scan costs roughly 1–3 US cents. The document is sent to Anthropic to be read; nothing from it is logged.

## BOQ from drawings (one-time setup)

**BOQ & Estimates** (under Money) makes a Bill of Quantities from drawings: PDF drawing sets, DXF, or DWG. The AI measures quantities by trade (Preliminaries, Substructure, Concrete & frame, Masonry, Roofing, Doors & windows, Finishes, Plumbing, Electrical, External works) and prices them from the **Maavel rate list** first; where a rate is blank it suggests a Maldives market rate, shown in orange for you to accept. Every BOQ starts as a **draft**: it is a budget-level estimate, so check the flagged notes and low-confidence lines before using it. Export to PDF or Excel (CSV), or use the total as a project's budget.

1. Run the **BOQ & estimates** section of `supabase/schema.sql` in the SQL Editor.
2. Deploy a function named `boq-generate` the same way as `scan-document`, pasting `supabase/functions/boq-generate/index.ts` (same `ANTHROPIC_API_KEY`).
3. Fill in your own rates under **BOQ & Estimates → Rate list** (MVR, supply and fix, before overhead and profit).

Tips: DXF and DWG are read in the browser and give exact lengths and counts when the drawing has proper layers. Plotted or exploded DWG sheets (everything on one layer at paper size) are scaled by the 1:N on the sheet, but the **PDF of the same set usually gives better quantities**. A BOQ costs roughly US$0.10–1.00 depending on the number of sheets, shown before you start.

## Files and scans

Uploaded files (passport copies, e-visas, photos, licences, project drawings) are kept in a private Supabase Storage bucket called `files`, created by `schema.sql`. Only signed-in people with a role can open them, through links that expire after 5 minutes; editors and admins can upload and delete. Phone photos are shrunk to about 2000 px before upload. The free plan includes 1 GB.

## 3. Day to day

- **Signing in:** enter your email and leave the password blank to get a sign-in link, or set a password on the **Team** tab and use that.
- **Access levels:** *Admin* can change everything including who has access. *Editor* can record payments, run payroll and edit staff. *Viewer* can only look and download PDFs.
- **Backups:** the Supabase free plan has no automatic backups. Once a month, go to **Table Editor**, open each table and use **Export → CSV**, or ask a developer to schedule a `pg_dump`. Uploaded files are in **Storage → files** and can be downloaded from there.
- **Inactivity:** a free Supabase project pauses if nobody uses it for a week. Your data is kept; open the Supabase dashboard and click **Restore**.

## Running it on a computer (developers)

```bash
npm install
cp .env.example .env.local   # then fill in the two Supabase values
npm run dev                  # http://localhost:5173
npm run build                # production build into dist/
```

Project layout:

```
src/
  App.tsx              sign-in gate, tabs, month picker
  auth/Login.tsx       email link / password sign-in
  data/DataContext.tsx loads tables, live updates, save/delete
  lib/calc.ts          payroll, bill status, estimate, document alerts
  lib/pdf.ts           expense, salary sheet and estimate PDFs
  views/               Dashboard, Month, Staff (+ StaffProfile), Payroll, Estimate, Projects, Company, Team
supabase/
  schema.sql           tables, row-level security, live updates
  seed.sql             starting data (Nov 2026)
```

Security is enforced in the database (row-level security in `schema.sql`), not only in the app: viewers cannot write even with their own tools, and only admins can change roles. The anon key is meant to be public; never put the **service_role** key in this app or in Cloudflare.
