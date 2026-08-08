-- Add free-text fields used by the fasting condition form.
-- This migration is additive and safe to run more than once.

alter table public.daily_conditions
  add column if not exists condition text,
  add column if not exists hunger_level integer,
  add column if not exists discomfort text,
  add column if not exists meal_log text,
  add column if not exists memo text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'daily_conditions_hunger_level_range'
      and conrelid = 'public.daily_conditions'::regclass
  ) then
    alter table public.daily_conditions
      add constraint daily_conditions_hunger_level_range
      check (hunger_level is null or hunger_level between 1 and 5);
  end if;
end
$$;

comment on column public.daily_conditions.condition is 'User-selected general condition.';
comment on column public.daily_conditions.hunger_level is 'Hunger level from 1 to 5.';
comment on column public.daily_conditions.discomfort is 'Free-text discomfort or symptoms note.';
comment on column public.daily_conditions.meal_log is 'Food and drink log for the day.';
comment on column public.daily_conditions.memo is 'Additional daily condition memo.';
