-- staff_profiles が読めない場合の修復用
-- Supabase SQL Editor で実行してください

-- 1) アルバイト管理者 enum（未追加なら追加）
alter type public.admin_permission add value if not exists 'part_time_admin';

-- 2) ヘルパー（SECURITY DEFINER で RLS 再帰を避ける）
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

grant execute on function private.is_part_time_admin() to authenticated;
grant execute on function private.can_manage_master() to authenticated;
grant execute on function public.is_part_time_admin() to authenticated;
grant execute on function public.can_manage_master() to authenticated;

-- 3) SELECT ポリシーを安全な形で作り直す
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

-- 4) PostgREST のスキーマキャッシュ更新
notify pgrst, 'reload schema';
