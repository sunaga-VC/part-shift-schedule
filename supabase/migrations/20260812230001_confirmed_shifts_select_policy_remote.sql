-- Step 2: remote 追加後に実行（enum 新値は別トランザクションでコミット後にのみ使用可）
drop policy if exists confirmed_shifts_select_policy on public.confirmed_shifts;

create policy confirmed_shifts_select_policy
  on public.confirmed_shifts for select to authenticated
  using (
    public.is_admin()
    or (
      staff_id = auth.uid()
      and status in ('confirmed', 'remote')
      and published_at is not null
    )
  );
