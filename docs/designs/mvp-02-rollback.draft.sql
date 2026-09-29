-- REVIEW ONLY. Forward-fix stop; DB APPLICATION NOT APPROVED.
begin;
do $$ begin raise exception 'MVP02_ROLLBACK_DRAFT_NOT_APPROVED'; end $$;
set local lock_timeout = '5s';

-- Also disable health feature flags and rebuild/redeploy only with separate approval.
-- Stop MVP-02 entry points; check in-flight transactions have completed before repair.
revoke execute on function public.save_health_entries_mvp02(uuid, jsonb)
  from public, anon, authenticated, service_role;
-- Defense in depth: stop executor mutations, NOT existing authenticated weight CRUD.
revoke insert (user_id, recorded_date, weight, body_fat_percentage),
  update (weight, body_fat_percentage) on public.weight_records from health_rpc_executor;
revoke insert (user_id, started_on) on public.menstrual_starts from health_rpc_executor;
revoke insert (user_id, request_id, payload_hash) on public.health_save_requests from health_rpc_executor;
-- Direct new menstrual writes were never granted, including to beta users.
revoke insert, update, delete on public.menstrual_starts from authenticated, anon, public;
-- Future edit/delete RPCs, if introduced, must ALSO lose EXECUTE and mutation grants.
commit;

-- PRESERVE all tables, health records, receipts and beta enrollments.
-- NO SET NOT NULL, DROP, zero filling, dummy weights or record deletion.
-- After any body-fat-only record exists, do NOT roll back to old NULL-unsafe code.
-- Forward fix: stop -> preserve -> diagnose -> repair -> isolated tests -> reauthorize.
-- Re-enabling EXECUTE/grants, any global manual-weight freeze, and restoring schema
-- require separate reviewed SQL/approval. Do not revoke existing users' weight CRUD.
