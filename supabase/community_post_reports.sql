-- Report support for community posts.
-- Run this after community_posts exists.

create table if not exists public.community_post_reports (
  post_id uuid references public.community_posts(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  reason text,
  created_at timestamp with time zone default now() not null,
  primary key (post_id, user_id)
);

alter table public.community_post_reports enable row level security;

drop policy if exists "community_post_reports_select_own" on public.community_post_reports;
drop policy if exists "community_post_reports_insert_own" on public.community_post_reports;

create policy "community_post_reports_select_own" on public.community_post_reports
  for select using (auth.uid() = user_id);

create policy "community_post_reports_insert_own" on public.community_post_reports
  for insert with check (auth.uid() = user_id);

create or replace function public.report_community_post(target_post_id uuid)
returns table(already_reported boolean, reports_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  next_reports integer;
  inserted_count integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into public.community_post_reports (post_id, user_id)
  values (target_post_id, auth.uid())
  on conflict do nothing;

  get diagnostics inserted_count = row_count;

  if inserted_count = 0 then
    select coalesce(public.community_posts.reports_count, 0)
    into next_reports
    from public.community_posts
    where id = target_post_id;

    return query select true, coalesce(next_reports, 0);
  end if;

  update public.community_posts
  set reports_count = coalesce(public.community_posts.reports_count, 0) + 1
  where id = target_post_id
  returning public.community_posts.reports_count into next_reports;

  return query select false, coalesce(next_reports, 0);
end;
$$;

grant execute on function public.report_community_post(uuid) to authenticated;
