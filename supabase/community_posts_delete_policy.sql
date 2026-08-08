-- Allow users to delete only their own community posts.

drop policy if exists "community_posts_delete_own" on public.community_posts;

create policy "community_posts_delete_own" on public.community_posts
  for delete using (auth.uid() = user_id);
