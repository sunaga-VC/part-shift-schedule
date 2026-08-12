-- アルバイト管理者向け RLS / ヘルパー関数
-- マスタ管理は可能だが、管理者アカウントの閲覧・操作は不可

create or replace function private.is_part_time_admin()
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
      and admin_permission = 'part_time_admin'
      and status = 'active'
  );
$$;

create or replace function private.can_manage_master()
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
      and admin_permission in ('manager', 'part_time_admin')
      and status = 'active'
  );
$$;

revoke all on function private.is_part_time_admin() from public;
revoke all on function private.can_manage_master() from public;
grant execute on function private.is_part_time_admin() to authenticated;
grant execute on function private.can_manage_master() to authenticated;

create or replace function public.is_part_time_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.is_part_time_admin();
$$;

create or replace function public.can_manage_master()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.can_manage_master();
$$;

revoke all on function public.is_part_time_admin() from public;
revoke all on function public.can_manage_master() from public;
grant execute on function public.is_part_time_admin() to authenticated;
grant execute on function public.can_manage_master() to authenticated;

-- departments: マネージャー / アルバイト管理者
drop policy if exists departments_write_manager on public.departments;
create policy departments_write_manager
  on public.departments for all to authenticated
  using (public.can_manage_master())
  with check (public.can_manage_master());

-- staff_profiles SELECT: アルバイト管理者は管理者行を見えない（自分自身は可）
drop policy if exists staff_profiles_select_self_or_admin on public.staff_profiles;
create policy staff_profiles_select_self_or_admin
  on public.staff_profiles for select to authenticated
  using (
    id = auth.uid()
    or public.is_manager()
    or (public.is_admin() and not public.is_part_time_admin())
    or (role = 'worker' and status = 'active')
    or (public.is_part_time_admin() and role = 'worker')
  );

-- staff_profiles WRITE: マネージャーは全員、アルバイト管理者はアルバイトのみ
drop policy if exists staff_profiles_write_manager on public.staff_profiles;
create policy staff_profiles_write_manager
  on public.staff_profiles for all to authenticated
  using (
    public.is_manager()
    or (public.is_part_time_admin() and role = 'worker')
  )
  with check (
    public.is_manager()
    or (public.is_part_time_admin() and role = 'worker')
  );

-- salary_raises: マネージャー / アルバイト管理者
drop policy if exists salary_raises_write_manager on public.salary_raises;
create policy salary_raises_write_manager
  on public.salary_raises for all to authenticated
  using (public.can_manage_master())
  with check (public.can_manage_master());
