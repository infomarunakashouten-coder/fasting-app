-- REVIEW ONLY. Final design conditionally approved; DB APPLICATION NOT APPROVED.
-- Apply only after Production read-path/validation compatibility and isolated RLS tests.
-- This guard deliberately prevents accidental application.
begin;
do $$ begin raise exception 'MVP02_DRAFT_NOT_APPROVED'; end $$;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Abort, do not silently clean or rewrite historical data.
do $$
begin
  if exists (
    select 1 from public.weight_records
    where (weight is null and body_fat_percentage is null)
      or (weight is not null and not (weight > 0 and weight <= 500.0))
      or (body_fat_percentage is not null and not (body_fat_percentage > 0 and body_fat_percentage <= 100.00))
  ) then
    raise exception 'MVP02_EXISTING_VALUES_REQUIRE_REVIEW';
  end if;
end $$;

-- Proposed range rules. Confirm any pre-existing same-name definitions before rerun.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.weight_records'::regclass and conname = 'health_weight_records_nonempty') then
    alter table public.weight_records add constraint health_weight_records_nonempty
      check (weight is not null or body_fat_percentage is not null) not valid;
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.weight_records'::regclass and conname = 'health_weight_records_weight_range') then
    alter table public.weight_records add constraint health_weight_records_weight_range
      check (weight is null or (weight > 0 and weight <= 500.0)) not valid;
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.weight_records'::regclass and conname = 'health_weight_records_body_fat_range') then
    alter table public.weight_records add constraint health_weight_records_body_fat_range
      check (body_fat_percentage is null or (body_fat_percentage > 0 and body_fat_percentage <= 100.00)) not valid;
  end if;
end $$;
alter table public.weight_records validate constraint health_weight_records_nonempty;
alter table public.weight_records validate constraint health_weight_records_weight_range;
alter table public.weight_records validate constraint health_weight_records_body_fat_range;
alter table public.weight_records alter column weight drop not null;
-- Do not alter precision, user_id nullability, unique/FK, profiles, or create daily_records.

create table if not exists public.health_beta_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default pg_catalog.now()
);
create table if not exists public.menstrual_starts (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_on date not null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint menstrual_starts_user_date_key unique (user_id, started_on)
);
create table if not exists public.health_save_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.now(),
  primary key (user_id, request_id)
);

-- Before rerun, compare all existing table definitions/FKs/defaults with this draft.
-- IF NOT EXISTS alone is not evidence that an old table has the correct schema.
alter table public.health_beta_users enable row level security;
alter table public.health_beta_users force row level security;
alter table public.menstrual_starts enable row level security;
alter table public.menstrual_starts force row level security;
alter table public.health_save_requests enable row level security;
alter table public.health_save_requests force row level security;

revoke all on public.health_beta_users, public.menstrual_starts, public.health_save_requests
  from public, anon, authenticated;
grant select on public.menstrual_starts to authenticated;

drop policy if exists health_beta_users_select_self on public.health_beta_users;
-- NO authenticated SELECT/DML grant or policy; beta check is internal to RPC.
-- No self-enrollment or beta-status public RPC.
drop policy if exists menstrual_starts_select_self on public.menstrual_starts;
create policy menstrual_starts_select_self on public.menstrual_starts
  for select to authenticated using (user_id = auth.uid());
drop policy if exists menstrual_starts_insert_beta on public.menstrual_starts;
drop policy if exists menstrual_starts_update_beta on public.menstrual_starts;
drop policy if exists menstrual_starts_delete_beta on public.menstrual_starts;
drop policy if exists health_save_requests_select_self on public.health_save_requests;
-- No direct receipt SELECT/DML for authenticated, including beta users.
-- Menstrual mutations ONLY through beta-gated RPCs. Save INSERT is granted below;
-- future edit/delete RPCs need separate validation, narrow column grants and RLS.

create or replace function public.health_mvp02_touch_menstrual_start()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end $$;
revoke all on function public.health_mvp02_touch_menstrual_start() from public, anon, authenticated;
drop trigger if exists health_mvp02_touch_menstrual_start on public.menstrual_starts;
create trigger health_mvp02_touch_menstrual_start before update on public.menstrual_starts
  for each row execute function public.health_mvp02_touch_menstrual_start();

-- Conditionally approved executor design; role creation/ownership still needs testing.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'health_rpc_executor') then
    create role health_rpc_executor nologin noinherit nosuperuser nobypassrls
      nocreatedb nocreaterole noreplication;
  else
    -- Do not reuse an unexpected privileged role.
    if exists (select 1 from pg_catalog.pg_roles where rolname = 'health_rpc_executor'
      and (rolcanlogin or rolinherit or rolsuper or rolbypassrls or rolcreatedb or rolcreaterole or rolreplication)) then
      raise exception 'MVP02_EXECUTOR_ROLE_UNSAFE';
    end if;
  end if;
  -- No inherited/SET ROLE path to another role; no application role membership.
  if exists (
    select 1 from pg_catalog.pg_auth_members m
    join pg_catalog.pg_roles r on r.oid = m.member
    join pg_catalog.pg_roles parent on parent.oid = m.roleid
    where r.rolname = 'health_rpc_executor'
      or (parent.rolname = 'health_rpc_executor'
        and not r.rolsuper and r.rolname not in ('postgres', 'supabase_admin'))
  ) then
    raise exception 'MVP02_EXECUTOR_MEMBERSHIP_UNSAFE';
  end if;
  if exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_roles r on r.oid = c.relowner
    where n.nspname = 'public' and r.rolname = 'health_rpc_executor'
      and c.relname in ('weight_records', 'health_beta_users', 'menstrual_starts', 'health_save_requests')
  ) then
    raise exception 'MVP02_EXECUTOR_MUST_NOT_OWN_TABLES';
  end if;
end $$;
-- Only reviewed installer membership may exist; no memberships granted here.
-- Review effective PUBLIC/default privileges; no extra role privileges are allowed.
grant usage on schema public, auth to health_rpc_executor;
grant execute on function auth.uid() to health_rpc_executor;
grant select on public.health_beta_users, public.health_save_requests,
  public.weight_records, public.menstrual_starts to health_rpc_executor;
grant insert (user_id, recorded_date, weight, body_fat_percentage),
  update (weight, body_fat_percentage) on public.weight_records to health_rpc_executor;
grant insert (user_id, started_on) on public.menstrual_starts to health_rpc_executor;
grant insert (user_id, request_id, payload_hash) on public.health_save_requests to health_rpc_executor;

drop policy if exists health_beta_users_executor_self on public.health_beta_users;
create policy health_beta_users_executor_self on public.health_beta_users
  for select to health_rpc_executor using (user_id = auth.uid());

-- Only add narrowly scoped policies; do not replace existing weight owner policies.
drop policy if exists health_weight_executor_select on public.weight_records;
create policy health_weight_executor_select on public.weight_records for select to health_rpc_executor
  using (user_id = auth.uid() and exists (select 1 from public.health_beta_users b where b.user_id = auth.uid()));
drop policy if exists health_weight_executor_insert on public.weight_records;
create policy health_weight_executor_insert on public.weight_records for insert to health_rpc_executor
  with check (user_id = auth.uid() and exists (select 1 from public.health_beta_users b where b.user_id = auth.uid()));
drop policy if exists health_weight_executor_update on public.weight_records;
create policy health_weight_executor_update on public.weight_records for update to health_rpc_executor
  using (user_id = auth.uid() and exists (select 1 from public.health_beta_users b where b.user_id = auth.uid()))
  with check (user_id = auth.uid() and exists (select 1 from public.health_beta_users b where b.user_id = auth.uid()));

drop policy if exists health_menstrual_executor_select on public.menstrual_starts;
create policy health_menstrual_executor_select on public.menstrual_starts for select to health_rpc_executor
  using (user_id = auth.uid() and exists (select 1 from public.health_beta_users b where b.user_id = auth.uid()));
drop policy if exists health_menstrual_executor_insert on public.menstrual_starts;
create policy health_menstrual_executor_insert on public.menstrual_starts for insert to health_rpc_executor
  with check (user_id = auth.uid() and exists (select 1 from public.health_beta_users b where b.user_id = auth.uid()));

drop policy if exists health_requests_executor_select on public.health_save_requests;
create policy health_requests_executor_select on public.health_save_requests for select to health_rpc_executor
  using (user_id = auth.uid() and exists (select 1 from public.health_beta_users b where b.user_id = auth.uid()));
drop policy if exists health_requests_executor_insert on public.health_save_requests;
create policy health_requests_executor_insert on public.health_save_requests for insert to health_rpc_executor
  with check (user_id = auth.uid() and exists (select 1 from public.health_beta_users b where b.user_id = auth.uid()));
-- End minimum executor grants. No membership grants to application roles.

-- No beta user is automatically inserted by this migration.
commit;
