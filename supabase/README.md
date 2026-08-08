# Supabase SQL guide

Project SQL Editor:

https://supabase.com/dashboard/project/nnhvxnqwbuxnqjrodzkp/sql/new

## Current required SQL

Run these files in this order:

1. `security_hardening_part1.sql`
2. `security_hardening_part2.sql`
3. `security_hardening_part3.sql`
4. `delete_current_user_account.sql`
5. `app_feedback.sql`
6. `fasting_plan_safety_consent.sql`
7. `fasting_plan_custom_duration.sql`
8. `daily_conditions_meal_times.sql`

The three `security_hardening_part*.sql` files:

- enables RLS for all tables currently used by the app
- restricts health records to the signed-in owner
- prevents users from granting themselves administrator access
- limits community author data to nickname and avatar
- limits community post reading to signed-in users
- adds a security status check shown on the app settings page

`delete_current_user_account.sql`:

- adds the complete account deletion function
- deletes only the currently authenticated account

`app_feedback.sql`:

- creates the monitor feedback and bug-report table
- lets signed-in users submit their own reports
- lets only administrators review and update report status

`fasting_plan_safety_consent.sql`:

- records the safety confirmation version and checked items with each plan
- records the confirmation time on the database server
- keeps canceled and replaced plans as history instead of deleting them

`fasting_plan_custom_duration.sql`:

- allows custom plans from 3 to 60 total days
- allows preparation, fasting, and recovery phases from 1 to 30 days each
- preserves all existing plan rows

These files are designed to be safe to run again.

After running the security, account deletion, and feedback files, reload the app
settings page. The monitor readiness status should show `4/4`.

- `データ保護設定済み`
- `完全退会機能：設定済み`

## Older migration files

The other SQL files remain as migration history. Do not rerun them unless a specific
error message asks for one. The split hardening files are the source of truth for
security setup in the Supabase SQL Editor.
