-- スタッフプロフィールに備考を追加
alter table public.staff_profiles
  add column if not exists note text not null default '';

comment on column public.staff_profiles.note is 'スタッフ備考（管理用）';
