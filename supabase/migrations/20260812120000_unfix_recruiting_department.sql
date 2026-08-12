-- リクルーティングの固定を解除（編集・削除可能にする）
update public.departments
set is_fixed = false
where name = 'リクルーティング';
