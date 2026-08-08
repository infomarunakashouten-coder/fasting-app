-- Community posts table for the renewed "ひろば" screen.
-- Run this in Supabase SQL Editor for the project used by fasting-diet.vercel.app.

create table if not exists public.community_posts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  category text not null,
  body text not null,
  is_anonymous boolean default false,
  likes_count integer default 0 not null,
  reports_count integer default 0 not null,
  created_at timestamp with time zone default now() not null
);

alter table public.community_posts add column if not exists is_anonymous boolean default false;
alter table public.community_posts add column if not exists likes_count integer default 0 not null;
alter table public.community_posts add column if not exists reports_count integer default 0 not null;

alter table public.community_posts enable row level security;

drop policy if exists "community_posts_select_all" on public.community_posts;
drop policy if exists "community_posts_insert_own" on public.community_posts;
drop policy if exists "community_posts_update_own" on public.community_posts;
drop policy if exists "community_posts_delete_own" on public.community_posts;

create policy "community_posts_select_all" on public.community_posts
  for select using (true);

create policy "community_posts_insert_own" on public.community_posts
  for insert with check (auth.uid() = user_id);

create policy "community_posts_update_own" on public.community_posts
  for update using (auth.uid() = user_id);

create policy "community_posts_delete_own" on public.community_posts
  for delete using (auth.uid() = user_id);
