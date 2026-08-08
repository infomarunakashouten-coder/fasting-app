-- Deletes only the currently authenticated user and rows owned by that user.
-- Run this once in the Supabase SQL Editor.

create or replace function public.delete_current_user_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  owned_table record;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  for owned_table in
    select distinct columns.table_name
    from information_schema.columns
    where columns.table_schema = 'public'
      and columns.column_name = 'user_id'
  loop
    execute format(
      'delete from public.%I where user_id = $1',
      owned_table.table_name
    )
    using current_user_id;
  end loop;

  if to_regclass('public.profiles') is not null then
    delete from public.profiles
    where id = current_user_id;
  end if;

  delete from auth.users
  where id = current_user_id;
end;
$$;

revoke all on function public.delete_current_user_account() from public;
grant execute on function public.delete_current_user_account() to authenticated;
