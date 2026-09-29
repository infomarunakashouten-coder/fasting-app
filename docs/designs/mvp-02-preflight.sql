-- READ ONLY. Aggregate data and schema/privilege metadata, no individual records.
-- Run BEFORE migration; run again immediately before applying approved migration.
select pg_catalog.count(*) as total_rows,
  pg_catalog.count(weight) as weight_nonnull_count,
  pg_catalog.count(*) filter (where weight is null) as weight_null_count,
  pg_catalog.min(weight) as weight_min, pg_catalog.max(weight) as weight_max,
  pg_catalog.count(body_fat_percentage) as body_fat_nonnull_count,
  pg_catalog.count(*) filter (where body_fat_percentage is null) as body_fat_null_count,
  pg_catalog.min(body_fat_percentage) as body_fat_min,
  pg_catalog.max(body_fat_percentage) as body_fat_max,
  pg_catalog.count(*) filter (where weight is not null and not (weight > 0 and weight <= 500.0)) as weight_outside_range,
  pg_catalog.count(*) filter (where body_fat_percentage is not null and not (body_fat_percentage > 0 and body_fat_percentage <= 100.00)) as body_fat_outside_range,
  pg_catalog.count(*) filter (where weight is null and body_fat_percentage is null) as empty_record_count,
  pg_catalog.count(*) filter (where weight is not null and weight <> pg_catalog.trunc(weight, 1)) as weight_precision_mismatch,
  pg_catalog.count(*) filter (where body_fat_percentage is not null and body_fat_percentage <> pg_catalog.trunc(body_fat_percentage, 2)) as body_fat_precision_mismatch
from public.weight_records;

-- Compact range recheck executed 2026-09-28: 61 / 0 / 0 / 0.
select pg_catalog.count(*) as total_rows,
  pg_catalog.count(*) filter (where weight is not null and not (weight > 0 and weight <= 500.0)) as invalid_weight,
  pg_catalog.count(*) filter (where body_fat_percentage is not null and not (body_fat_percentage > 0 and body_fat_percentage <= 100.00)) as invalid_body_fat,
  pg_catalog.count(*) filter (where weight is null and body_fat_percentage is null) as both_null
from public.weight_records;

-- Metadata only. Missing new objects before application is expected.
select c.relname, r.rolname as table_owner, c.relrowsecurity, c.relforcerowsecurity
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
join pg_catalog.pg_roles r on r.oid = c.relowner
where n.nspname = 'public' and c.relkind = 'r'
  and c.relname in ('weight_records', 'health_beta_users', 'menstrual_starts', 'health_save_requests');
select table_name, column_name, is_nullable, numeric_precision, numeric_scale
from information_schema.columns
where table_schema = 'public' and table_name in ('weight_records', 'health_save_requests', 'menstrual_starts', 'health_beta_users')
order by table_name, ordinal_position;
select c.conname, pg_catalog.pg_get_constraintdef(c.oid) as definition, c.convalidated
from pg_catalog.pg_constraint c
join pg_catalog.pg_class t on t.oid = c.conrelid
join pg_catalog.pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public'
  and t.relname in ('weight_records', 'health_beta_users', 'menstrual_starts', 'health_save_requests');
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_catalog.pg_policies
where schemaname = 'public' and tablename in ('weight_records', 'health_beta_users', 'menstrual_starts', 'health_save_requests');

-- Role safety. Zero rows before role creation is expected.
select rolname, rolcanlogin, rolinherit, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
from pg_catalog.pg_roles where rolname = 'health_rpc_executor';
select parent.rolname as granted_role, member.rolname as member_role
from pg_catalog.pg_auth_members m
join pg_catalog.pg_roles parent on parent.oid = m.roleid
join pg_catalog.pg_roles member on member.oid = m.member
where parent.rolname = 'health_rpc_executor' or member.rolname = 'health_rpc_executor';

-- Review BOTH table and column grants, including PUBLIC/default privileges.
select grantee, table_name, privilege_type
from information_schema.table_privileges
where table_schema = 'public'
  and table_name in ('weight_records', 'health_beta_users', 'menstrual_starts', 'health_save_requests')
order by table_name, grantee, privilege_type;
select grantee, table_name, column_name, privilege_type
from information_schema.column_privileges
where table_schema = 'public'
  and table_name in ('weight_records', 'health_beta_users', 'menstrual_starts', 'health_save_requests')
order by table_name, grantee, column_name, privilege_type;

select p.proname, r.rolname as function_owner, p.prosecdef, p.proconfig, p.proacl
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
join pg_catalog.pg_roles r on r.oid = p.proowner
where n.nspname = 'public'
  and p.proname in ('save_health_entries_mvp02', 'health_mvp02_touch_menstrual_start', 'delete_current_user_account');

-- After role creation only (join makes this safe when role does not exist).
select r.rolname,
  pg_catalog.has_schema_privilege(r.oid, 'public', 'CREATE') as unsafe_schema_create,
  pg_catalog.has_table_privilege(r.oid, 'auth.users', 'INSERT,UPDATE,DELETE') as unsafe_auth_write
from pg_catalog.pg_roles r where r.rolname = 'health_rpc_executor';
-- Privilege metadata is necessary but insufficient: isolated JWT/RLS execution
-- tests must verify anon/nonbeta/beta/other-user and direct receipt/beta refusal.
-- This file never applies DDL, calls save/delete RPC, or retrieves personal rows.
