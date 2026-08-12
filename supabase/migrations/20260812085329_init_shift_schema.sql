-- Shift adjustment app schema for Supabase
-- Replaces localStorage AppState with normalized tables + Auth-linked staff.
-- Do NOT apply to unrelated projects (e.g. recruitment DBs).

create extension if not exists "pgcrypto";

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.staff_role as enum ('worker', 'admin');
create type public.admin_permission as enum ('manager', 'general');
create type public.employment_status as enum ('active', 'inactive');
create type public.shift_period_status as enum ('draft', 'editing', 'adjusting', 'published');
create type public.confirmed_shift_status as enum ('adjusting', 'unconfirmed', 'confirmed');
create type public.message_audience as enum ('all', 'team');

-- ---------------------------------------------------------------------------
-- Departments (所属 / チーム)
-- ---------------------------------------------------------------------------
create table public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_fixed boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.departments is '所属チーム。旧 AppState.departments[] を正規化。';
comment on column public.departments.is_fixed is 'リクルーティング等の削除不可部署';

-- ---------------------------------------------------------------------------
-- Staff profiles (auth.users と 1:1)
-- 平文 password は廃止。ログインは Supabase Auth を使う。
-- ---------------------------------------------------------------------------
create table public.staff_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  last_name text not null,
  first_name text not null default '',
  display_given_name boolean not null default false,
  icon_label text not null default '',
  department_id uuid references public.departments (id) on delete set null,
  role public.staff_role not null default 'worker',
  admin_permission public.admin_permission not null default 'general',
  status public.employment_status not null default 'active',
  weekly_contract_hours numeric(6, 2) not null default 0
    check (weekly_contract_hours >= 0),
  social_insurance boolean not null default false,
  hire_date date,
  contract_start_date date,
  contract_end_date date,
  contract_renewal_months integer not null default 3
    check (contract_renewal_months >= 1),
  hourly_wage integer not null default 0
    check (hourly_wage >= 0),
  google_email text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_profiles_admin_permission_chk check (
    (role = 'admin')
    or (role = 'worker' and admin_permission = 'general')
  )
);

create index staff_profiles_department_id_idx on public.staff_profiles (department_id);
create index staff_profiles_role_status_idx on public.staff_profiles (role, status);
create index staff_profiles_contract_end_date_idx on public.staff_profiles (contract_end_date)
  where status = 'active' and role = 'worker';

comment on table public.staff_profiles is 'スタッフ/管理者プロフィール。旧 Staff。権限は user_metadata ではなく本テーブルで判定。';
comment on column public.staff_profiles.last_name is '姓（旧 name）';
comment on column public.staff_profiles.first_name is '名（旧 firstName）';

-- ---------------------------------------------------------------------------
-- Salary raises (昇給履歴)
-- ---------------------------------------------------------------------------
create table public.salary_raises (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff_profiles (id) on delete cascade,
  effective_date date not null,
  hourly_wage integer not null check (hourly_wage >= 0),
  note text not null default '',
  created_at timestamptz not null default now()
);

create index salary_raises_staff_effective_idx
  on public.salary_raises (staff_id, effective_date desc);

-- ---------------------------------------------------------------------------
-- Shift periods
-- ---------------------------------------------------------------------------
create table public.shift_periods (
  id uuid primary key default gen_random_uuid(),
  adjustment_status public.shift_period_status not null default 'draft',
  published_week_start_date date,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Desired shifts (希望)
-- ---------------------------------------------------------------------------
create table public.desired_shifts (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff_profiles (id) on delete cascade,
  period_id uuid not null references public.shift_periods (id) on delete cascade,
  work_date date not null,
  start_time time not null,
  end_time time not null,
  break_minutes integer not null default 0 check (break_minutes >= 0),
  actual_minutes integer not null default 0 check (actual_minutes >= 0),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint desired_shifts_time_chk check (end_time > start_time),
  constraint desired_shifts_staff_date_uniq unique (staff_id, work_date)
);

create index desired_shifts_period_date_idx on public.desired_shifts (period_id, work_date);
create index desired_shifts_date_idx on public.desired_shifts (work_date);

-- ---------------------------------------------------------------------------
-- Confirmed shifts (確定)
-- ---------------------------------------------------------------------------
create table public.confirmed_shifts (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff_profiles (id) on delete cascade,
  period_id uuid not null references public.shift_periods (id) on delete cascade,
  work_date date not null,
  status public.confirmed_shift_status not null default 'adjusting',
  start_time time not null,
  end_time time not null,
  break_minutes integer not null default 0 check (break_minutes >= 0),
  actual_minutes integer not null default 0 check (actual_minutes >= 0),
  note text not null default '',
  admin_note text not null default '',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint confirmed_shifts_time_chk check (end_time > start_time),
  constraint confirmed_shifts_staff_date_uniq unique (staff_id, work_date)
);

create index confirmed_shifts_period_date_idx on public.confirmed_shifts (period_id, work_date);
create index confirmed_shifts_date_status_idx on public.confirmed_shifts (work_date, status);
create index confirmed_shifts_published_idx on public.confirmed_shifts (staff_id, work_date)
  where published_at is not null and status = 'confirmed';

-- ---------------------------------------------------------------------------
-- Goal blocks (目安アイコン)
-- 旧 goalBlocksByDate[date][blockIndex][slot] = departmentName
-- ---------------------------------------------------------------------------
create table public.goal_block_slots (
  id uuid primary key default gen_random_uuid(),
  work_date date not null,
  block_index smallint not null check (block_index between 0 and 3),
  slot_index smallint not null check (slot_index >= 0),
  department_id uuid not null references public.departments (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint goal_block_slots_uniq unique (work_date, block_index, slot_index)
);

create index goal_block_slots_date_idx on public.goal_block_slots (work_date);
create index goal_block_slots_department_date_idx
  on public.goal_block_slots (department_id, work_date);

-- ---------------------------------------------------------------------------
-- Required shifts (日別メモ等。分数は goal_block_slots から算出可)
-- ---------------------------------------------------------------------------
create table public.required_shifts (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.shift_periods (id) on delete cascade,
  work_date date not null,
  required_people integer not null default 0 check (required_people >= 0),
  required_minutes integer not null default 0 check (required_minutes >= 0),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint required_shifts_period_date_uniq unique (period_id, work_date)
);

create index required_shifts_date_idx on public.required_shifts (work_date);

-- ---------------------------------------------------------------------------
-- Home messages (アルバイトホームお知らせ)
-- ---------------------------------------------------------------------------
create table public.home_messages (
  id uuid primary key default gen_random_uuid(),
  body text not null check (char_length(trim(body)) > 0),
  created_by uuid not null references public.staff_profiles (id) on delete restrict,
  audience public.message_audience not null default 'all',
  department_id uuid references public.departments (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint home_messages_audience_chk check (
    (audience = 'all' and department_id is null)
    or (audience = 'team' and department_id is not null)
  )
);

create index home_messages_created_at_idx on public.home_messages (created_at desc);
create index home_messages_department_id_idx on public.home_messages (department_id);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger departments_set_updated_at
  before update on public.departments
  for each row execute function private.set_updated_at();

create trigger staff_profiles_set_updated_at
  before update on public.staff_profiles
  for each row execute function private.set_updated_at();

create trigger shift_periods_set_updated_at
  before update on public.shift_periods
  for each row execute function private.set_updated_at();

create trigger desired_shifts_set_updated_at
  before update on public.desired_shifts
  for each row execute function private.set_updated_at();

create trigger confirmed_shifts_set_updated_at
  before update on public.confirmed_shifts
  for each row execute function private.set_updated_at();

create trigger required_shifts_set_updated_at
  before update on public.required_shifts
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Auth helpers (SECURITY DEFINER). Do not expose via Data API grants.
-- Role/permission MUST come from staff_profiles, never auth.users.user_metadata.
-- ---------------------------------------------------------------------------
create or replace function private.current_staff()
returns public.staff_profiles
language sql
stable
security definer
set search_path = public
as $$
  select *
  from public.staff_profiles
  where id = auth.uid();
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff_profiles
    where id = auth.uid()
      and role = 'admin'
      and status = 'active'
  );
$$;

create or replace function private.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff_profiles
    where id = auth.uid()
      and role = 'admin'
      and admin_permission = 'manager'
      and status = 'active'
  );
$$;

revoke all on function private.current_staff() from public;
revoke all on function private.is_admin() from public;
revoke all on function private.is_manager() from public;

grant execute on function private.is_admin() to authenticated;
grant execute on function private.is_manager() to authenticated;

-- Thin wrappers in public for RLS policy expressions (still security definer)
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.is_admin();
$$;

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.is_manager();
$$;

revoke all on function public.is_admin() from public;
revoke all on function public.is_manager() from public;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_manager() to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.departments enable row level security;
alter table public.staff_profiles enable row level security;
alter table public.salary_raises enable row level security;
alter table public.shift_periods enable row level security;
alter table public.desired_shifts enable row level security;
alter table public.confirmed_shifts enable row level security;
alter table public.goal_block_slots enable row level security;
alter table public.required_shifts enable row level security;
alter table public.home_messages enable row level security;

-- departments
create policy departments_select_authenticated
  on public.departments for select to authenticated
  using (true);

create policy departments_write_manager
  on public.departments for all to authenticated
  using (public.is_manager())
  with check (public.is_manager());

-- staff_profiles
create policy staff_profiles_select_self_or_admin
  on public.staff_profiles for select to authenticated
  using (
    id = auth.uid()
    or public.is_admin()
    or (role = 'worker' and status = 'active')
  );

create policy staff_profiles_write_manager
  on public.staff_profiles for all to authenticated
  using (public.is_manager())
  with check (public.is_manager());

-- salary_raises
create policy salary_raises_select_self_or_admin
  on public.salary_raises for select to authenticated
  using (staff_id = auth.uid() or public.is_admin());

create policy salary_raises_write_manager
  on public.salary_raises for all to authenticated
  using (public.is_manager())
  with check (public.is_manager());

-- shift_periods
create policy shift_periods_select_authenticated
  on public.shift_periods for select to authenticated
  using (true);

create policy shift_periods_write_admin
  on public.shift_periods for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- desired_shifts
create policy desired_shifts_select_self_or_admin
  on public.desired_shifts for select to authenticated
  using (staff_id = auth.uid() or public.is_admin());

create policy desired_shifts_insert_self
  on public.desired_shifts for insert to authenticated
  with check (staff_id = auth.uid() or public.is_admin());

create policy desired_shifts_update_self_or_admin
  on public.desired_shifts for update to authenticated
  using (staff_id = auth.uid() or public.is_admin())
  with check (staff_id = auth.uid() or public.is_admin());

create policy desired_shifts_delete_self_or_admin
  on public.desired_shifts for delete to authenticated
  using (staff_id = auth.uid() or public.is_admin());

-- confirmed_shifts
create policy confirmed_shifts_select_policy
  on public.confirmed_shifts for select to authenticated
  using (
    public.is_admin()
    or (
      staff_id = auth.uid()
      and status = 'confirmed'
      and published_at is not null
    )
  );

create policy confirmed_shifts_write_admin
  on public.confirmed_shifts for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- goal_block_slots
create policy goal_block_slots_select_authenticated
  on public.goal_block_slots for select to authenticated
  using (true);

create policy goal_block_slots_write_admin
  on public.goal_block_slots for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- required_shifts
create policy required_shifts_select_authenticated
  on public.required_shifts for select to authenticated
  using (true);

create policy required_shifts_write_admin
  on public.required_shifts for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- home_messages
create policy home_messages_select_policy
  on public.home_messages for select to authenticated
  using (
    public.is_admin()
    or audience = 'all'
    or (
      audience = 'team'
      and department_id = (select department_id from public.staff_profiles where id = auth.uid())
    )
  );

create policy home_messages_write_admin
  on public.home_messages for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Grants (explicit; avoid relying on auto_expose)
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Seed placeholder period (optional bootstrap)
insert into public.shift_periods (id, adjustment_status)
values ('00000000-0000-4000-8000-000000000001', 'editing')
on conflict do nothing;
