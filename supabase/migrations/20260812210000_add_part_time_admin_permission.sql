-- アルバイト管理者（part_time_admin）を enum に追加
-- ※ 同一トランザクション内では新値を参照できないため、関数/RLS は次の migration で行う
alter type public.admin_permission add value if not exists 'part_time_admin';
