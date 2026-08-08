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
