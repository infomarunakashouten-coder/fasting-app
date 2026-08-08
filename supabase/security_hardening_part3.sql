create or replace function public.get_app_security_status()
returns table (
  configured boolean,
  account_deletion_ready boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (
      coalesce((
        select relrowsecurity
        from pg_catalog.pg_class
        where oid = 'public.profiles'::regclass
      ), false)
      and coalesce((
        select relrowsecurity
        from pg_catalog.pg_class
        where oid = 'public.community_posts'::regclass
      ), false)
      and to_regprocedure('public.get_community_authors(uuid[])') is not null
      and exists (
        select 1
        from pg_catalog.pg_trigger
        where tgrelid = 'public.profiles'::regclass
          and tgname = 'protect_profile_system_fields'
          and not tgisinternal
      )
    ) as configured,
    to_regprocedure('public.delete_current_user_account()') is not null
      as account_deletion_ready;
$$;

revoke all on function public.get_app_security_status() from public;
grant execute on function public.get_app_security_status() to authenticated;
