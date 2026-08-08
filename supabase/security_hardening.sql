-- Security hardening for the current Fasting Diet Tracker database.
-- Run once in the Supabase SQL Editor. It is safe to run again.

alter table public.profiles
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table public.profiles
  add column if not exists is_admin boolean default false not null;

alter table public.profiles
  add column if not exists avatar_path text;

alter table public.profiles
  add column if not exists avatar_seed text;

alter table public.community_posts
  add column if not exists is_hidden boolean default false not null;

alter table public.community_posts
  add column if not exists needs_review boolean default false not null;

update public.profiles
set user_id = id
where user_id is null;

create index if not exists profiles_user_id_idx
  on public.profiles(user_id);

alter table public.profiles enable row level security;

do $$
declare
  policy_row record;
begin
  for policy_row in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
  loop
    execute format(
      'drop policy if exists %I on public.profiles',
      policy_row.policyname
    );
  end loop;
end
$$;

create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using (auth.uid() = id or auth.uid() = user_id);

create policy "profiles_insert_own" on public.profiles
  for insert to authenticated
  with check (auth.uid() = id or auth.uid() = user_id);

create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (auth.uid() = id or auth.uid() = user_id)
  with check (auth.uid() = id or auth.uid() = user_id);

create policy "profiles_delete_own" on public.profiles
  for delete to authenticated
  using (auth.uid() = id or auth.uid() = user_id);

create or replace function public.is_current_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where (id = auth.uid() or user_id = auth.uid())
      and coalesce(is_admin, false) = true
  );
$$;

revoke all on function public.is_current_admin() from public;
grant execute on function public.is_current_admin() to authenticated;

create or replace function public.protect_profile_system_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.is_current_admin() then
    new.id := old.id;
    new.user_id := old.user_id;
    new.is_admin := old.is_admin;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_system_fields on public.profiles;
create trigger protect_profile_system_fields
  before update on public.profiles
  for each row execute function public.protect_profile_system_fields();

create or replace function public.get_community_authors(target_user_ids uuid[])
returns table (
  user_id uuid,
  nickname text,
  avatar_path text,
  avatar_seed text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(profiles.user_id, profiles.id) as user_id,
    coalesce(profiles.nickname, 'ユーザー') as nickname,
    profiles.avatar_path,
    profiles.avatar_seed
  from public.profiles
  where auth.uid() is not null
    and coalesce(profiles.user_id, profiles.id) = any(target_user_ids);
$$;

revoke all on function public.get_community_authors(uuid[]) from public;
grant execute on function public.get_community_authors(uuid[]) to authenticated;

do $$
declare
  current_table text;
  policy_row record;
  private_tables text[] := array[
    'daily_records',
    'weight_records',
    'daily_conditions',
    'fasting_plans',
    'fasting_records',
    'fasting_logs',
    'diagnosis_results',
    'meal_checks',
    'status_posts',
    'community_post_likes',
    'community_post_reports'
  ];
begin
  foreach current_table in array private_tables
  loop
    if to_regclass(format('public.%I', current_table)) is null then
      continue;
    end if;

    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = current_table
        and column_name = 'user_id'
    ) then
      raise notice 'Skipping %. RLS was not changed because user_id does not exist.', current_table;
      continue;
    end if;

    execute format('alter table public.%I enable row level security', current_table);

    for policy_row in
      select policyname
      from pg_policies
      where schemaname = 'public' and tablename = current_table
    loop
      execute format(
        'drop policy if exists %I on public.%I',
        policy_row.policyname,
        current_table
      );
    end loop;

    execute format(
      'create policy %I on public.%I for select to authenticated using (auth.uid() = user_id)',
      current_table || '_select_own',
      current_table
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (auth.uid() = user_id)',
      current_table || '_insert_own',
      current_table
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      current_table || '_update_own',
      current_table
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (auth.uid() = user_id)',
      current_table || '_delete_own',
      current_table
    );
  end loop;
end
$$;

alter table public.community_posts enable row level security;

do $$
declare
  policy_row record;
begin
  for policy_row in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'community_posts'
  loop
    execute format(
      'drop policy if exists %I on public.community_posts',
      policy_row.policyname
    );
  end loop;
end
$$;

create policy "community_posts_select_authenticated" on public.community_posts
  for select to authenticated
  using (
    auth.uid() is not null
    and (not coalesce(is_hidden, false) or public.is_current_admin())
  );

create policy "community_posts_insert_own" on public.community_posts
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy "community_posts_delete_own" on public.community_posts
  for delete to authenticated
  using (auth.uid() = user_id or public.is_current_admin());

revoke update on public.community_posts from authenticated;
grant select, insert, delete on public.community_posts to authenticated;

do $$
begin
  if to_regprocedure('public.toggle_community_post_like(uuid)') is not null then
    execute 'revoke all on function public.toggle_community_post_like(uuid) from public';
    execute 'grant execute on function public.toggle_community_post_like(uuid) to authenticated';
  end if;

  if to_regprocedure('public.report_community_post(uuid)') is not null then
    execute 'revoke all on function public.report_community_post(uuid) from public';
    execute 'grant execute on function public.report_community_post(uuid) to authenticated';
  end if;

  if to_regprocedure('public.admin_moderate_community_post(uuid,text)') is not null then
    execute 'revoke all on function public.admin_moderate_community_post(uuid, text) from public';
    execute 'grant execute on function public.admin_moderate_community_post(uuid, text) to authenticated';
  end if;
end
$$;

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
