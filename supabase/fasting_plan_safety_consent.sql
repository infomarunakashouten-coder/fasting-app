-- Preserve the safety confirmation accepted for each fasting plan.
-- Safe to run more than once.

alter table public.fasting_plans
  add column if not exists safety_consent_version text,
  add column if not exists safety_confirmed_at timestamp with time zone,
  add column if not exists safety_confirmations jsonb,
  add column if not exists safety_notice_text text;

create or replace function public.set_fasting_plan_safety_confirmed_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.safety_consent_version is not null and new.safety_confirmed_at is null then
    new.safety_confirmed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists fasting_plan_safety_confirmed_at on public.fasting_plans;
create trigger fasting_plan_safety_confirmed_at
  before insert on public.fasting_plans
  for each row execute function public.set_fasting_plan_safety_confirmed_at();

comment on column public.fasting_plans.safety_consent_version is
  'Version of the safety confirmation text accepted for this plan.';
comment on column public.fasting_plans.safety_confirmed_at is
  'Server-recorded plan submission time associated with the safety confirmation.';
comment on column public.fasting_plans.safety_confirmations is
  'Confirmation items accepted by the user when the plan was created.';
comment on column public.fasting_plans.safety_notice_text is
  'Safety and non-medical notice displayed when the plan was created.';
