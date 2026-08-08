-- Like support for community posts.
-- Run this after community_posts exists.

create table if not exists public.community_post_likes (
  post_id uuid references public.community_posts(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  created_at timestamp with time zone default now() not null,
  primary key (post_id, user_id)
);

alter table public.community_post_likes enable row level security;

drop policy if exists "community_post_likes_select_own" on public.community_post_likes;
drop policy if exists "community_post_likes_insert_own" on public.community_post_likes;
drop policy if exists "community_post_likes_delete_own" on public.community_post_likes;

create policy "community_post_likes_select_own" on public.community_post_likes
  for select using (auth.uid() = user_id);

create policy "community_post_likes_insert_own" on public.community_post_likes
  for insert with check (auth.uid() = user_id);

create policy "community_post_likes_delete_own" on public.community_post_likes
  for delete using (auth.uid() = user_id);

create or replace function public.toggle_community_post_like(target_post_id uuid)
returns table(liked boolean, likes_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  next_likes integer;
  inserted_count integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if exists (
    select 1
    from public.community_post_likes
    where post_id = target_post_id and user_id = auth.uid()
  ) then
    delete from public.community_post_likes
    where post_id = target_post_id and user_id = auth.uid();

    update public.community_posts
    set likes_count = greatest(coalesce(public.community_posts.likes_count, 0) - 1, 0)
    where id = target_post_id
    returning public.community_posts.likes_count into next_likes;

    return query select false, coalesce(next_likes, 0);
  end if;

  insert into public.community_post_likes (post_id, user_id)
  values (target_post_id, auth.uid())
  on conflict do nothing;

  get diagnostics inserted_count = row_count;

  if inserted_count > 0 then
    update public.community_posts
    set likes_count = coalesce(public.community_posts.likes_count, 0) + 1
    where id = target_post_id
    returning public.community_posts.likes_count into next_likes;
  else
    select coalesce(public.community_posts.likes_count, 0)
    into next_likes
    from public.community_posts
    where id = target_post_id;
  end if;

  return query select true, coalesce(next_likes, 0);
end;
$$;

grant execute on function public.toggle_community_post_like(uuid) to authenticated;
