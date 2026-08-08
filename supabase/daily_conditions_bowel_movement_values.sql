-- Align the database constraint with the Japanese options used by the app.
-- NOT VALID preserves historical rows that may contain legacy values while
-- still enforcing the new values for inserts and updates.
alter table public.daily_conditions
  drop constraint if exists daily_conditions_bowel_movement_check;

alter table public.daily_conditions
  add constraint daily_conditions_bowel_movement_check
  check (bowel_movement is null or bowel_movement in ('なし', 'あり'))
  not valid;
