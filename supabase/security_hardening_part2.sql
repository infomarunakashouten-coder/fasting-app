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
