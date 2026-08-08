-- Allow custom fasting plans using the three phase-day columns.
-- This migration does not delete or rewrite existing plan history.
-- Safe to run more than once.

alter table public.fasting_plans
  add column if not exists prep_days integer,
  add column if not exists main_days integer,
  add column if not exists recovery_days integer,
  add column if not exists status text default 'active';

alter table public.fasting_plans
  drop constraint if exists fasting_plans_phase_days_range;

alter table public.fasting_plans
  add constraint fasting_plans_phase_days_range
  check (
    (prep_days is null or prep_days between 1 and 30)
    and (main_days is null or main_days between 1 and 30)
    and (recovery_days is null or recovery_days between 1 and 30)
    and (
      prep_days is null
      or main_days is null
      or recovery_days is null
      or prep_days + main_days + recovery_days between 3 and 60
    )
  );

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'fasting_plans'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%status%'
  loop
    execute format(
      'alter table public.fasting_plans drop constraint if exists %I',
      constraint_name
    );
  end loop;
end
$$;

-- Do not add a new status constraint here. Older versions used additional
-- values such as completed, so preserving those rows is safer than rewriting
-- historical plan states. The app writes active, inactive, or canceled for
-- newly changed plans.
alter table public.fasting_plans
  drop constraint if exists fasting_plans_status_values;
