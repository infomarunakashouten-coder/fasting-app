alter table public.profiles
  add column if not exists birth_date date;

alter table public.profiles
  add column if not exists age integer;
