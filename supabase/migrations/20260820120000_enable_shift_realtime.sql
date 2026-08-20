-- 希望シフトなどの変更を管理者画面へ即時届けるため、
-- Realtime publication にシフト関連テーブルを追加する。
-- 同一 DB 内の採用管理テーブルは対象外。

alter table public.desired_shifts replica identity full;
alter table public.confirmed_shifts replica identity full;
alter table public.required_shifts replica identity full;
alter table public.goal_block_slots replica identity full;
alter table public.goal_memos replica identity full;
alter table public.shift_periods replica identity full;

do $$
declare
  t text;
begin
  foreach t in array array[
    'desired_shifts',
    'confirmed_shifts',
    'required_shifts',
    'goal_block_slots',
    'goal_memos',
    'shift_periods'
  ]
  loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
