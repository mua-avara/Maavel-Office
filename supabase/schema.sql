-- Maavel Office: database schema for Supabase (Postgres)
-- Run once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.

-- ---------- People who can sign in ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'viewer' check (role in ('admin','editor','viewer')),
  created_at timestamptz not null default now()
);

-- New sign-ins get a profile automatically (as viewer). Promote people from the Team tab.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email,
          case when not exists (select 1 from public.profiles) then 'admin' else 'viewer' end)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

-- People who signed in before this file was run get a profile too.
-- If nobody has a profile yet, the earliest sign-in becomes admin.
insert into public.profiles (id, email, role)
select u.id, coalesce(u.email, ''),
       case when not exists (select 1 from public.profiles)
             and u.id = (select id from auth.users order by created_at limit 1)
            then 'admin' else 'viewer' end
from auth.users u
on conflict (id) do nothing;

-- ---------- Business data ----------
create table if not exists public.staff (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  designation text default '',
  country text default '',
  status text not null default 'Active' check (status in ('Active','On leave','Left')),
  basic numeric not null default 0,
  food numeric not null default 0,
  allowance numeric not null default 0,
  join_date date,
  left_date date,
  phone text default '',
  passport_no text default '',
  passport_exp date,
  wp_no text default '',
  wp_exp date,
  visa_exp date,
  medical_exp date,
  insurance_exp date,
  notes text default '',
  sort_order int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.bills (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  category text not null default 'Other',
  amount numeric,               -- null = varies month to month
  due_day int not null default 10 check (due_day between 1 and 31),
  provider text default '',
  account text default '',
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.payments (
  id text primary key default gen_random_uuid()::text,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  bill_id text references public.bills(id) on delete set null,
  description text not null default '',
  category text not null default 'Other',
  amount numeric not null default 0,
  date date not null,
  method text default '',
  ref text default '',
  created_at timestamptz not null default now()
);
create index if not exists payments_month_idx on public.payments(month);

create table if not exists public.payroll_months (
  month text primary key check (month ~ '^\d{4}-\d{2}$'),
  salaries numeric not null default 0,
  food numeric not null default 0,
  allowances numeric not null default 0,
  staff_count int,
  lines jsonb,                   -- per-person lines when built in the app
  pay_status text not null default 'paid' check (pay_status in ('draft','paid')),
  paid_date date,
  source text default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.estimate_items (
  id text primary key default gen_random_uuid()::text,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  description text not null,
  category text not null default 'Other',
  amount numeric not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists estimate_items_month_idx on public.estimate_items(month);

-- ---------- Row level security ----------
-- Everyone signed in with a profile can read. Admins and editors can change data.
-- Only admins can change who has which role.
alter table public.profiles       enable row level security;
alter table public.staff          enable row level security;
alter table public.bills          enable row level security;
alter table public.payments       enable row level security;
alter table public.payroll_months enable row level security;
alter table public.estimate_items enable row level security;

drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated using (public.my_role() is not null);
drop policy if exists "profiles admin update" on public.profiles;
create policy "profiles admin update" on public.profiles for update to authenticated using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
drop policy if exists "profiles self name" on public.profiles;
create policy "profiles self name" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid() and role = public.my_role());

do $$
declare t text;
begin
  foreach t in array array['staff','bills','payments','payroll_months','estimate_items'] loop
    execute format('drop policy if exists "%1$s read" on public.%1$I', t);
    execute format('create policy "%1$s read" on public.%1$I for select to authenticated using (public.my_role() is not null)', t);
    execute format('drop policy if exists "%1$s write" on public.%1$I', t);
    execute format('create policy "%1$s write" on public.%1$I for all to authenticated using (public.my_role() in (''admin'',''editor'')) with check (public.my_role() in (''admin'',''editor''))', t);
  end loop;
end $$;

-- ---------- Live updates ----------
do $$
declare t text;
begin
  foreach t in array array['staff','bills','payments','payroll_months','estimate_items','profiles'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---------- Director dashboard: company documents and to-dos (added Nov 2026) ----------
-- Self-contained and safe to re-run: paste just this section into the SQL Editor if the rest is already set up.
create table if not exists public.company_docs (
  id text primary key default gen_random_uuid()::text,
  name text not null,                       -- e.g. Business registration, SME registration, Vehicle registration
  category text not null default 'Other',
  number text default '',
  issuer text default '',                   -- e.g. Ministry of Economic Development, MIRA, Transport Authority
  issue_date date,
  expiry_date date,                         -- null = does not expire
  renewal_cost numeric,
  notes text default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id text primary key default gen_random_uuid()::text,
  title text not null,
  due_date date,
  owner text default '',                    -- who should do it (free text)
  priority text not null default 'Normal' check (priority in ('High','Normal','Low')),
  done boolean not null default false,
  done_date date,
  notes text default '',
  created_at timestamptz not null default now()
);

alter table public.company_docs enable row level security;
alter table public.tasks        enable row level security;

do $$
declare t text;
begin
  foreach t in array array['company_docs','tasks'] loop
    execute format('drop policy if exists "%1$s read" on public.%1$I', t);
    execute format('create policy "%1$s read" on public.%1$I for select to authenticated using (public.my_role() is not null)', t);
    execute format('drop policy if exists "%1$s write" on public.%1$I', t);
    execute format('create policy "%1$s write" on public.%1$I for all to authenticated using (public.my_role() in (''admin'',''editor'')) with check (public.my_role() in (''admin'',''editor''))', t);
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---------- Table access for signed-in users (added Nov 2026) ----------
-- Newer Supabase projects don't give the API roles access to tables made in SQL.
-- Signed-in users get table access here; the row-level security policies above
-- still decide what each role (admin, editor, viewer) can actually see or change.
-- Visitors who are not signed in (anon) get nothing.
grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.profiles, public.staff, public.bills, public.payments,
  public.payroll_months, public.estimate_items, public.company_docs, public.tasks
  to authenticated;
grant execute on function public.my_role() to authenticated;

-- ---------- Upgrade: files, staff profiles, leave, projects (added Nov 2026) ----------
-- Self-contained and safe to re-run: paste just this section into the SQL Editor.

-- Staff: e-visa number, leave entitlement, emergency contact, current site.
alter table public.staff add column if not exists visa_no text default '';
alter table public.staff add column if not exists annual_leave_days int not null default 30;
alter table public.staff add column if not exists emergency_contact text default '';

create table if not exists public.projects (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  client text default '',
  location text default '',
  status text not null default 'Active' check (status in ('Active','On hold','Completed')),
  start_date date,
  end_date date,
  contract_value numeric,
  budget numeric,
  notes text default '',
  created_at timestamptz not null default now()
);
alter table public.staff    add column if not exists project_id text references public.projects(id) on delete set null;
alter table public.payments add column if not exists project_id text references public.projects(id) on delete set null;

create table if not exists public.leaves (
  id text primary key default gen_random_uuid()::text,
  staff_id text not null references public.staff(id) on delete cascade,
  type text not null default 'Annual' check (type in ('Annual','Sick','Emergency','Unpaid','Other')),
  start_date date not null,
  end_date date not null,
  days numeric not null default 1,
  notes text default '',
  created_at timestamptz not null default now()
);
create index if not exists leaves_staff_idx on public.leaves(staff_id);

-- Uploaded files: the file itself is in Storage (bucket "files"), this row describes it.
create table if not exists public.files (
  id text primary key default gen_random_uuid()::text,
  owner_type text not null check (owner_type in ('staff','company_doc','project')),
  owner_id text not null,
  kind text not null default 'Other',
  name text not null,
  path text not null unique,
  mime text default '',
  size bigint default 0,
  uploaded_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists files_owner_idx on public.files(owner_type, owner_id);

alter table public.projects enable row level security;
alter table public.leaves   enable row level security;
alter table public.files    enable row level security;

do $$
declare t text;
begin
  foreach t in array array['projects','leaves','files'] loop
    execute format('drop policy if exists "%1$s read" on public.%1$I', t);
    execute format('create policy "%1$s read" on public.%1$I for select to authenticated using (public.my_role() is not null)', t);
    execute format('drop policy if exists "%1$s write" on public.%1$I', t);
    execute format('create policy "%1$s write" on public.%1$I for all to authenticated using (public.my_role() in (''admin'',''editor'')) with check (public.my_role() in (''admin'',''editor''))', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- Private storage bucket for scans and photos (images and PDFs, up to 20 MB each).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('files', 'files', false, 20971520, array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "maavel files read"   on storage.objects;
drop policy if exists "maavel files insert" on storage.objects;
drop policy if exists "maavel files update" on storage.objects;
drop policy if exists "maavel files delete" on storage.objects;
create policy "maavel files read"   on storage.objects for select to authenticated using (bucket_id = 'files' and public.my_role() is not null);
create policy "maavel files insert" on storage.objects for insert to authenticated with check (bucket_id = 'files' and public.my_role() in ('admin','editor'));
create policy "maavel files update" on storage.objects for update to authenticated using (bucket_id = 'files' and public.my_role() in ('admin','editor'));
create policy "maavel files delete" on storage.objects for delete to authenticated using (bucket_id = 'files' and public.my_role() in ('admin','editor'));

-- ---------- Access for the admin-users function (added Nov 2026) ----------
-- The Edge Function uses the secret key (service_role). Newer projects don't give
-- that role table access automatically, so it couldn't check who is an admin.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;

-- ---------- Bills: where to send the payment (added Nov 2026) ----------
alter table public.bills add column if not exists pay_name text default '';
alter table public.bills add column if not exists pay_account text default '';
alter table public.bills add column if not exists pay_bank text default '';

-- ---------- Vehicles & equipment register (added Nov 2026) ----------
-- Self-contained and safe to re-run: paste just this section into the SQL Editor.
create table if not exists public.assets (
  id text primary key default gen_random_uuid()::text,
  kind text not null default 'vehicle' check (kind in ('vehicle','machinery')),
  type text not null default 'Other',
  name text not null,
  reg_no text default '',
  make text default '',
  model text default '',
  year int,
  colour text default '',
  chassis_no text default '',
  engine_no text default '',
  serial_no text default '',
  registered_owner text default '',
  status text not null default 'In use' check (status in ('In use','Idle','Under repair','Sold')),
  project_id text references public.projects(id) on delete set null,
  purchase_date date,
  purchase_price numeric,
  annual_fee_due date,
  annual_fee numeric,
  insurance_exp date,
  insurance_provider text default '',
  policy_no text default '',
  roadworthy_exp date,
  notes text default '',
  created_at timestamptz not null default now()
);
alter table public.assets enable row level security;
drop policy if exists "assets read" on public.assets;
create policy "assets read" on public.assets for select to authenticated using (public.my_role() is not null);
drop policy if exists "assets write" on public.assets;
create policy "assets write" on public.assets for all to authenticated using (public.my_role() in ('admin','editor')) with check (public.my_role() in ('admin','editor'));
grant select, insert, update, delete on public.assets to authenticated;
grant select, insert, update, delete on public.assets to service_role;
do $$ begin
  alter publication supabase_realtime add table public.assets;
exception when duplicate_object then null; end $$;

-- Files can now belong to a vehicle or machine too.
alter table public.files drop constraint if exists files_owner_type_check;
alter table public.files add constraint files_owner_type_check check (owner_type in ('staff','company_doc','project','asset'));

-- ---------- BOQ & estimates (added Nov 2026) ----------
-- Self-contained and safe to re-run: paste just this section into the SQL Editor.
create table if not exists public.boq_rates (
  id text primary key default gen_random_uuid()::text,
  code text default '',
  section text not null default 'Other',
  description text not null,
  unit text not null default 'nos',
  rate numeric,
  notes text default '',
  updated_at timestamptz not null default now()
);
create table if not exists public.boqs (
  id text primary key default gen_random_uuid()::text,
  project_id text references public.projects(id) on delete set null,
  title text not null,
  status text not null default 'reading' check (status in ('reading','draft','final')),
  assumptions jsonb not null default '{}'::jsonb,
  source jsonb not null default '{}'::jsonb,
  overhead_pct numeric not null default 10,
  contingency_pct numeric not null default 5,
  notes text default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create table if not exists public.boq_items (
  id text primary key default gen_random_uuid()::text,
  boq_id text not null references public.boqs(id) on delete cascade,
  section text not null default 'Other',
  item_no text default '',
  description text not null,
  unit text not null default 'nos',
  qty numeric not null default 0,
  rate numeric,
  rate_source text not null default 'manual' check (rate_source in ('maavel','suggested','manual')),
  rate_note text default '',
  confidence text not null default 'medium' check (confidence in ('high','medium','low')),
  basis text default '',
  sheet text default '',
  sort int not null default 0
);
create index if not exists boq_items_boq_idx on public.boq_items(boq_id);

do $$
declare t text;
begin
  foreach t in array array['boq_rates','boqs','boq_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%1$s read" on public.%1$I', t);
    execute format('create policy "%1$s read" on public.%1$I for select to authenticated using (public.my_role() is not null)', t);
    execute format('drop policy if exists "%1$s write" on public.%1$I', t);
    execute format('create policy "%1$s write" on public.%1$I for all to authenticated using (public.my_role() in (''admin'',''editor'')) with check (public.my_role() in (''admin'',''editor''))', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated, service_role', t);
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- Drawings can be attached to a BOQ.
alter table public.files drop constraint if exists files_owner_type_check;
alter table public.files add constraint files_owner_type_check check (owner_type in ('staff','company_doc','project','asset','boq'));

-- Starter rate list (rates left blank for Maavel to fill). Only added once.
insert into public.boq_rates (code, section, description, unit)
select * from (values
  ('PRE-01','Preliminaries','Site establishment, temporary facilities and mobilisation','item'),
  ('SUB-01','Substructure','Excavation for foundations, disposal on site','m3'),
  ('SUB-02','Substructure','Sand / coral backfill, compacted in layers','m3'),
  ('SUB-03','Substructure','Lean concrete blinding 50 mm','m2'),
  ('CON-01','Concrete & frame','Reinforced concrete grade C25 in footings','m3'),
  ('CON-02','Concrete & frame','Reinforced concrete grade C25 in columns','m3'),
  ('CON-03','Concrete & frame','Reinforced concrete grade C25 in beams','m3'),
  ('CON-04','Concrete & frame','Reinforced concrete grade C25 in suspended slabs','m3'),
  ('CON-05','Concrete & frame','High-yield steel reinforcement, cut, bent and fixed','kg'),
  ('CON-06','Concrete & frame','Formwork to sides and soffits','m2'),
  ('MAS-01','Masonry','150 mm hollow concrete blockwork','m2'),
  ('MAS-02','Masonry','200 mm hollow concrete blockwork','m2'),
  ('ROF-01','Roofing','Roof covering, metal sheet on purlins including insulation','m2'),
  ('ROF-02','Roofing','Waterproofing membrane to flat roof','m2'),
  ('DW-01','Doors & windows','Internal door complete with frame and ironmongery','nos'),
  ('DW-02','Doors & windows','External door complete with frame and ironmongery','nos'),
  ('DW-03','Doors & windows','Aluminium window with glazing','m2'),
  ('FIN-01','Finishes','Cement sand plaster 15 mm to walls','m2'),
  ('FIN-02','Finishes','Emulsion paint, two coats on primer, to walls and ceilings','m2'),
  ('FIN-03','Finishes','Ceramic floor tiles on screed','m2'),
  ('FIN-04','Finishes','Ceramic wall tiles in wet areas','m2'),
  ('FIN-05','Finishes','Gypsum board false ceiling','m2'),
  ('PLM-01','Plumbing','Sanitary fixtures complete (WC, basin, shower)','nos'),
  ('PLM-02','Plumbing','Water supply and drainage pipework','item'),
  ('ELE-01','Electrical','Lighting and power points complete','nos'),
  ('ELE-02','Electrical','Distribution board, wiring and earthing','item'),
  ('EXT-01','External works','Paving / external hard landscaping','m2')
) as v(code, section, description, unit)
where not exists (select 1 from public.boq_rates);
