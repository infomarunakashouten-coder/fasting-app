-- Admin moderation support for community posts.
-- 1. Run this SQL.
-- 2. Set your own profile row is_admin = true in Table Editor.
-- 3. Open /admin/community.

alter table public.profiles add column if not exists is_admin boolean default false not null;
alter table public.community_posts add column if not exists is_hidden boolean default false not null;
alter table public.community_posts add column if not exists needs_review boolean default false not null;

create or replace function public.is_current_admin()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  has_id boolean;
  has_user_id boolean;
  admin_found boolean := false;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'id'
  ) into has_id;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'user_id'
  ) into has_user_id;

  if has_id then
    execute 'select exists (select 1 from public.profiles where id = $1 and coalesce(is_admin, false) = true)'
    using auth.uid()
    into admin_found;
    if admin_found then
      return true;
    end if;
  end if;

  if has_user_id then
    execute 'select exists (select 1 from public.profiles where user_id = $1 and coalesce(is_admin, false) = true)'
    using auth.uid()
    into admin_found;
    if admin_found then
      return true;
    end if;
  end if;

  return false;
end;
$$;

create or replace function public.admin_moderate_community_post(target_post_id uuid, action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_current_admin() then
    raise exception 'admin permission required';
  end if;

  if action = 'restore' then
    update public.community_posts
    set is_hidden = false,
        needs_review = false,
        reports_count = 0
    where id = target_post_id;
    return;
  end if;

  if action = 'hide' then
    update public.community_posts
    set is_hidden = true,
        needs_review = true
    where id = target_post_id;
    return;
  end if;

  if action = 'delete' then
    delete from public.community_posts
    where id = target_post_id;
    return;
  end if;

  raise exception 'invalid moderation action';
end;
$$;

grant execute on function public.is_current_admin() to authenticated;
grant execute on function public.admin_moderate_community_post(uuid, text) to authenticated;
