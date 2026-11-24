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
