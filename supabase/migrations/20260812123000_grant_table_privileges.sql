-- permission denied for table departments 対策
-- RLS ポリシーとは別に、テーブル権限（GRANT）が必要

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;
grant select on all tables in schema public to anon;

grant usage, select on all sequences in schema public to authenticated, service_role;

-- 明示（確実に departments を開けるようにする）
grant select, insert, update, delete on table public.departments to authenticated, service_role;
grant select on table public.departments to anon;

grant select, insert, update, delete on table public.staff_profiles to authenticated, service_role;
grant select on table public.staff_profiles to anon;

grant select, insert, update, delete on table public.salary_raises to authenticated, service_role;
grant select, insert, update, delete on table public.home_messages to authenticated, service_role;
grant select, insert, update, delete on table public.shift_periods to authenticated, service_role;
grant select, insert, update, delete on table public.desired_shifts to authenticated, service_role;
grant select, insert, update, delete on table public.confirmed_shifts to authenticated, service_role;
grant select, insert, update, delete on table public.goal_block_slots to authenticated, service_role;
grant select, insert, update, delete on table public.goal_memos to authenticated, service_role;
grant select, insert, update, delete on table public.required_shifts to authenticated, service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;

alter default privileges in schema public
  grant select on tables to anon;
