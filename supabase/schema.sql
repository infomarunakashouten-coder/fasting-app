-- =====================================================
-- Fasting Diet Tracker - Supabase Schema
-- =====================================================

-- プロフィールテーブル
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  nickname text,
  age integer check (age >= 10 and age <= 120),
  birth_date date,
  gender text check (gender in ('female', 'male', 'other')),
  height_cm numeric(5,1) check (height_cm > 0 and height_cm < 300),
  current_weight_kg numeric(5,1) check (current_weight_kg > 0 and current_weight_kg < 500),
  goal_weight_kg numeric(5,1) check (goal_weight_kg > 0 and goal_weight_kg < 500),
  body_fat_percentage numeric(4,1) check (body_fat_percentage >= 0 and body_fat_percentage <= 100),
  muscle_mass_kg numeric(5,1) check (muscle_mass_kg >= 0),
  waist_cm numeric(5,1) check (waist_cm >= 0),
  menstrual_cycle_days integer check (menstrual_cycle_days > 0 and menstrual_cycle_days <= 90),
  sleep_hours numeric(3,1) check (sleep_hours >= 0 and sleep_hours <= 24),
  start_weight_kg numeric(5,1) check (start_weight_kg > 0 and start_weight_kg < 500),
  notifications_enabled boolean default true,
  plan_type text default 'free' check (plan_type in ('free', 'ai_fasting')),
  ai_checks_remaining integer default 0 check (ai_checks_remaining >= 0),
  ai_checks_used_month integer default 0 check (ai_checks_used_month >= 0),
  ai_checks_reset_on date,
  subscription_current_period_end date,
  subscription_cancel_at_period_end boolean default false,
  avatar_path text,
  avatar_seed text,
  is_profile_complete boolean default false,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- 既存プロジェクトで再実行する場合の追加カラム
alter table public.profiles add column if not exists start_weight_kg numeric(5,1) check (start_weight_kg > 0 and start_weight_kg < 500);
alter table public.profiles add column if not exists notifications_enabled boolean default true;
alter table public.profiles add column if not exists plan_type text default 'free' check (plan_type in ('free', 'ai_fasting'));
alter table public.profiles add column if not exists ai_checks_remaining integer default 0 check (ai_checks_remaining >= 0);
alter table public.profiles add column if not exists ai_checks_used_month integer default 0 check (ai_checks_used_month >= 0);
alter table public.profiles add column if not exists ai_checks_reset_on date;
alter table public.profiles add column if not exists subscription_current_period_end date;
alter table public.profiles add column if not exists subscription_cancel_at_period_end boolean default false;
alter table public.profiles add column if not exists avatar_path text;
alter table public.profiles add column if not exists avatar_seed text;
alter table public.profiles add column if not exists birth_date date;

-- 毎日の記録テーブル
create table if not exists public.daily_records (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  recorded_date date not null,
  weight_kg numeric(5,1) check (weight_kg > 0 and weight_kg < 500),
  body_fat_percentage numeric(4,1) check (body_fat_percentage >= 0 and body_fat_percentage <= 100),
  memo text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  unique(user_id, recorded_date)
);

-- ファスティングタイプ診断結果テーブル
create table if not exists public.diagnosis_results (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  fasting_type text not null,
  answers jsonb,
  created_at timestamp with time zone default now()
);

-- ファスティング計画
create table if not exists public.fasting_plans (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  start_date date not null,
  duration_days integer not null check (duration_days between 3 and 60),
  prep_days integer check (prep_days between 1 and 30),
  main_days integer check (main_days between 1 and 30),
  recovery_days integer check (recovery_days between 1 and 30),
  main_drink text not null check (main_drink in ('ミキ', '甘酒', '発酵ドリンク', 'その他')),
  notifications_enabled boolean default true,
  memo text,
  safety_consent_version text,
  safety_confirmed_at timestamp with time zone,
  safety_confirmations jsonb,
  safety_notice_text text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

alter table public.fasting_plans add column if not exists safety_consent_version text;
alter table public.fasting_plans add column if not exists safety_confirmed_at timestamp with time zone;
alter table public.fasting_plans add column if not exists safety_confirmations jsonb;
alter table public.fasting_plans add column if not exists safety_notice_text text;
alter table public.fasting_plans add column if not exists prep_days integer;
alter table public.fasting_plans add column if not exists main_days integer;
alter table public.fasting_plans add column if not exists recovery_days integer;
alter table public.fasting_plans add column if not exists duration_days integer;
alter table public.fasting_plans add column if not exists status text default 'active';

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

-- ファスティング実施中記録
create table if not exists public.fasting_records (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  plan_id uuid references public.fasting_plans on delete set null,
  recorded_date date not null,
  phase text,
  weight_kg numeric(5,1) check (weight_kg > 0 and weight_kg < 500),
  body_fat_percentage numeric(4,1) check (body_fat_percentage >= 0 and body_fat_percentage <= 100),
  water_liters numeric(3,1) check (water_liters >= 0 and water_liters <= 20),
  hunger_level integer check (hunger_level >= 1 and hunger_level <= 5),
  condition text,
  sleep_hours numeric(3,1) check (sleep_hours >= 0 and sleep_hours <= 24),
  bowel_movement text,
  swelling boolean,
  discomfort text,
  meal_photo_url text,
  ai_checked boolean default false,
  memo text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  unique(user_id, recorded_date)
);

-- 食事写真AIチェック
create table if not exists public.meal_checks (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  check_type text not null check (check_type in ('通常食', '準備食', '回復食')),
  photo_url text,
  ai_comment text,
  created_at timestamp with time zone default now()
);

-- ひろば投稿
create table if not exists public.community_posts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  category text not null,
  body text not null,
  is_anonymous boolean default true,
  likes_count integer default 0,
  reports_count integer default 0,
  created_at timestamp with time zone default now()
);

-- =====================================================
-- RLS (Row Level Security) ポリシー
-- =====================================================

alter table public.profiles enable row level security;
alter table public.daily_records enable row level security;
alter table public.diagnosis_results enable row level security;
alter table public.fasting_plans enable row level security;
alter table public.fasting_records enable row level security;
alter table public.meal_checks enable row level security;
alter table public.community_posts enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "daily_records_select_own" on public.daily_records;
drop policy if exists "daily_records_insert_own" on public.daily_records;
drop policy if exists "daily_records_update_own" on public.daily_records;
drop policy if exists "daily_records_delete_own" on public.daily_records;
drop policy if exists "diagnosis_results_select_own" on public.diagnosis_results;
drop policy if exists "diagnosis_results_insert_own" on public.diagnosis_results;
drop policy if exists "diagnosis_results_delete_own" on public.diagnosis_results;
drop policy if exists "fasting_plans_select_own" on public.fasting_plans;
drop policy if exists "fasting_plans_insert_own" on public.fasting_plans;
drop policy if exists "fasting_plans_update_own" on public.fasting_plans;
drop policy if exists "fasting_plans_delete_own" on public.fasting_plans;
drop policy if exists "fasting_records_select_own" on public.fasting_records;
drop policy if exists "fasting_records_insert_own" on public.fasting_records;
drop policy if exists "fasting_records_update_own" on public.fasting_records;
drop policy if exists "fasting_records_delete_own" on public.fasting_records;
drop policy if exists "meal_checks_select_own" on public.meal_checks;
drop policy if exists "meal_checks_insert_own" on public.meal_checks;
drop policy if exists "community_posts_select_all" on public.community_posts;
drop policy if exists "community_posts_insert_own" on public.community_posts;
drop policy if exists "community_posts_update_own" on public.community_posts;
drop policy if exists "community_posts_delete_own" on public.community_posts;

-- プロフィール: 自分のデータのみ参照・更新可能
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- 毎日の記録: 自分のデータのみ操作可能
create policy "daily_records_select_own" on public.daily_records
  for select using (auth.uid() = user_id);

create policy "daily_records_insert_own" on public.daily_records
  for insert with check (auth.uid() = user_id);

create policy "daily_records_update_own" on public.daily_records
  for update using (auth.uid() = user_id);

create policy "daily_records_delete_own" on public.daily_records
  for delete using (auth.uid() = user_id);

-- 診断結果: 自分のデータのみ操作可能
create policy "diagnosis_results_select_own" on public.diagnosis_results
  for select using (auth.uid() = user_id);

create policy "diagnosis_results_insert_own" on public.diagnosis_results
  for insert with check (auth.uid() = user_id);

create policy "diagnosis_results_delete_own" on public.diagnosis_results
  for delete using (auth.uid() = user_id);

-- ファスティング計画・記録: 自分のデータのみ操作可能
create policy "fasting_plans_select_own" on public.fasting_plans
  for select using (auth.uid() = user_id);
create policy "fasting_plans_insert_own" on public.fasting_plans
  for insert with check (auth.uid() = user_id);
create policy "fasting_plans_update_own" on public.fasting_plans
  for update using (auth.uid() = user_id);
create policy "fasting_plans_delete_own" on public.fasting_plans
  for delete using (auth.uid() = user_id);

create policy "fasting_records_select_own" on public.fasting_records
  for select using (auth.uid() = user_id);
create policy "fasting_records_insert_own" on public.fasting_records
  for insert with check (auth.uid() = user_id);
create policy "fasting_records_update_own" on public.fasting_records
  for update using (auth.uid() = user_id);
create policy "fasting_records_delete_own" on public.fasting_records
  for delete using (auth.uid() = user_id);

-- AIチェック: 自分の履歴のみ参照・追加
create policy "meal_checks_select_own" on public.meal_checks
  for select using (auth.uid() = user_id);
create policy "meal_checks_insert_own" on public.meal_checks
  for insert with check (auth.uid() = user_id);

-- ひろば投稿: 全員が閲覧、作成者のみ編集削除
create policy "community_posts_select_all" on public.community_posts
  for select using (true);
create policy "community_posts_insert_own" on public.community_posts
  for insert with check (auth.uid() = user_id);
create policy "community_posts_update_own" on public.community_posts
  for update using (auth.uid() = user_id);
create policy "community_posts_delete_own" on public.community_posts
  for delete using (auth.uid() = user_id);

-- =====================================================
-- トリガー: updated_at 自動更新
-- =====================================================

create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.handle_updated_at();

drop trigger if exists daily_records_updated_at on public.daily_records;
create trigger daily_records_updated_at
  before update on public.daily_records
  for each row execute procedure public.handle_updated_at();

drop trigger if exists fasting_plans_updated_at on public.fasting_plans;
create trigger fasting_plans_updated_at
  before update on public.fasting_plans
  for each row execute procedure public.handle_updated_at();

drop trigger if exists fasting_records_updated_at on public.fasting_records;
create trigger fasting_records_updated_at
  before update on public.fasting_records
  for each row execute procedure public.handle_updated_at();

-- =====================================================
-- トリガー: 新規ユーザー登録時にプロフィール行を自動作成
-- =====================================================

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, is_profile_complete)
  values (new.id, false);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Complete account deletion. The function can only delete the authenticated user.
create or replace function public.delete_current_user_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  owned_table record;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  for owned_table in
    select distinct columns.table_name
    from information_schema.columns
    where columns.table_schema = 'public'
      and columns.column_name = 'user_id'
  loop
    execute format(
      'delete from public.%I where user_id = $1',
      owned_table.table_name
    )
    using current_user_id;
  end loop;

  if to_regclass('public.profiles') is not null then
    delete from public.profiles
    where id = current_user_id;
  end if;

  delete from auth.users
  where id = current_user_id;
end;
$$;

revoke all on function public.delete_current_user_account() from public;
grant execute on function public.delete_current_user_account() to authenticated;
