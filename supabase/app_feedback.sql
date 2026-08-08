create table if not exists public.app_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('bug', 'usability', 'request', 'other')),
  message text not null check (char_length(message) between 10 and 1000),
  page_path text,
  status text not null default 'new' check (status in ('new', 'reviewing', 'resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.app_feedback enable row level security;

drop policy if exists "app_feedback_insert_own" on public.app_feedback;
create policy "app_feedback_insert_own"
on public.app_feedback
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "app_feedback_select_own" on public.app_feedback;
create policy "app_feedback_select_own"
on public.app_feedback
for select
to authenticated
using (
  auth.uid() = user_id
  or exists (
    select 1
    from public.profiles
    where (profiles.id = auth.uid() or profiles.user_id = auth.uid())
      and profiles.is_admin = true
  )
);

drop policy if exists "app_feedback_admin_update" on public.app_feedback;
create policy "app_feedback_admin_update"
on public.app_feedback
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where (profiles.id = auth.uid() or profiles.user_id = auth.uid())
      and profiles.is_admin = true
  )
)
with check (
  exists (
    select 1
    from public.profiles
    where (profiles.id = auth.uid() or profiles.user_id = auth.uid())
      and profiles.is_admin = true
  )
);

create index if not exists app_feedback_status_created_at_idx
  on public.app_feedback (status, created_at desc);

create or replace function public.set_app_feedback_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists app_feedback_set_updated_at on public.app_feedback;
create trigger app_feedback_set_updated_at
before update on public.app_feedback
for each row execute function public.set_app_feedback_updated_at();
