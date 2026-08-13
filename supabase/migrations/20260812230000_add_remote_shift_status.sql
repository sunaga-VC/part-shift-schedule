-- Step 1: enum に remote を追加（このファイルだけ先にコミットされる必要がある）
do $$
begin
  alter type public.confirmed_shift_status add value 'remote';
exception
  when duplicate_object then null;
end $$;
