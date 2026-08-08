-- Store meal time and the preceding no-food duration.

alter table public.daily_conditions
  add column if not exists eating_time time,
  add column if not exists meal_times text[] not null default '{}',
  add column if not exists fasting_hours numeric(5, 1);

alter table public.daily_conditions
  drop constraint if exists daily_conditions_fasting_hours_range;

alter table public.daily_conditions
  add constraint daily_conditions_fasting_hours_range
  check (fasting_hours is null or (fasting_hours >= 0 and fasting_hours <= 168));

comment on column public.daily_conditions.eating_time is 'Local time at which the user ate.';
comment on column public.daily_conditions.meal_times is 'All local meal times recorded for the day.';
comment on column public.daily_conditions.fasting_hours is 'Hours without food before the recorded meal.';
