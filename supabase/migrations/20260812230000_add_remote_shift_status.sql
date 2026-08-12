-- 確定シフトに「在宅」ステータスを追加（出社と同様に扱う）
do $$
begin
  alter type public.confirmed_shift_status add value 'remote';
exception
  when duplicate_object then null;
end $$;

-- アルバイト本人は出社・在宅の公開済みシフトを閲覧可能
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
