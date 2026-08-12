-- このファイルを Supabase SQL Editor に貼り付けて実行してください
-- 対象プロジェクト: voyvdlkvjxvcgbpecupu（part_time アプリ）

create table if not exists public.staff_managed_departments (
  staff_id uuid not null references public.staff_profiles (id) on delete cascade,
  department_id uuid not null references public.departments (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (staff_id, department_id)
);

create index if not exists staff_managed_departments_department_idx
  on public.staff_managed_departments (department_id);

comment on table public.staff_managed_departments is '管理者がシフト調整（ガント・確定）できる所属の多対多';

alter table public.staff_managed_departments enable row level security;

drop policy if exists staff_managed_departments_select on public.staff_managed_departments;
create policy staff_managed_departments_select
  on public.staff_managed_departments for select to authenticated
  using (
    staff_id = auth.uid()
    or public.is_admin()
  );

drop policy if exists staff_managed_departments_write on public.staff_managed_departments;
create policy staff_managed_departments_write
  on public.staff_managed_departments for all to authenticated
  using (public.is_manager())
  with check (public.is_manager());

grant select, insert, update, delete on table public.staff_managed_departments to authenticated, service_role;

update public.departments
set is_fixed = false
where name = '本部';

update public.staff_profiles sp
set department_id = null
where sp.department_id in (select id from public.departments where name = '本部')
  and sp.role = 'admin';

delete from public.departments d
where d.name = '本部'
  and not exists (
    select 1 from public.staff_profiles sp where sp.department_id = d.id
  );

insert into public.staff_managed_departments (staff_id, department_id)
select sp.id, d.id
from public.staff_profiles sp
cross join public.departments d
where sp.role = 'admin'
  and sp.admin_permission = 'manager'
  and d.name <> '本部'
on conflict do nothing;
