-- リクルーティングを固定所属に戻す
insert into public.departments (name, is_fixed, sort_order)
values
  ('リクルーティング', true, 0),
  ('本部', true, 1)
on conflict (name) do update
set
  is_fixed = excluded.is_fixed,
  sort_order = least(public.departments.sort_order, excluded.sort_order);
