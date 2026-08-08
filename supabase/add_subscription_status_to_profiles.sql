-- プラン変更予約の保存先を追加します。
-- Supabase SQL Editorで一度実行してください。

alter table public.profiles
  add column if not exists subscription_cancel_at_period_end boolean default false;

alter table public.profiles
  add column if not exists subscription_current_period_end date;

alter table public.profiles
  add column if not exists next_billing_date date;
