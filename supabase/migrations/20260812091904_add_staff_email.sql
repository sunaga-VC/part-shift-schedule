-- ログイン用メール（Auth の email と揃える）
alter table public.staff_profiles
  add column if not exists email text not null default '';

create unique index if not exists staff_profiles_email_unique_idx
  on public.staff_profiles (lower(email))
  where email <> '';

comment on column public.staff_profiles.email is 'ログイン用メール。auth.users.email と対応させる';
