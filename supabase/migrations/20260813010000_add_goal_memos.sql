-- Goal memos (備考)
-- 既存の GoalMemo を Supabase で共有するための永続化テーブル

create type public.goal_memo_frequency as enum ('daily', 'weekdays', 'monthly');
create type public.goal_memo_monthly_mode as enum ('single', 'range');

create table if not exists public.goal_memos (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.shift_periods (id) on delete cascade,
  body text not null check (char_length(trim(body)) > 0),
  start_date date not null,
  end_date date not null,
  frequency public.goal_memo_frequency not null default 'daily',
  weekdays smallint[] not null default '{}'::smallint[],
  repeat_months integer not null default 3 check (repeat_months >= 1),
  monthly_mode public.goal_memo_monthly_mode not null default 'single',
  month_day integer not null default 1 check (month_day between 1 and 31),
  month_day_start integer not null default 1 check (month_day_start between 1 and 31),
  month_day_end integer not null default 1 check (month_day_end between 1 and 31),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint goal_memos_date_chk check (end_date >= start_date)
);

create index if not exists goal_memos_period_date_idx
  on public.goal_memos (period_id, start_date, end_date);

alter table public.goal_memos enable row level security;

drop policy if exists goal_memos_select_authenticated on public.goal_memos;
create policy goal_memos_select_authenticated
  on public.goal_memos for select to authenticated
  using (true);

drop policy if exists goal_memos_write_admin on public.goal_memos;
create policy goal_memos_write_admin
  on public.goal_memos for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update, delete on table public.goal_memos to authenticated, service_role;

