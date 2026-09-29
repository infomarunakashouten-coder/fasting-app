-- REVIEW ONLY. Conditionally approved SECURITY DEFINER design; NOT APPLIED.
-- Requires Production compatibility, schema draft, isolated PostgreSQL/RLS tests,
-- and separate DB application approval. Guard stays until that approval.
begin;
do $$ begin raise exception 'MVP02_RPC_DRAFT_NOT_APPROVED'; end $$;

create or replace function public.save_health_entries_mvp02(
  p_request_id uuid,
  p_entries jsonb
) returns jsonb
language plpgsql
security definer -- Conditionally approved; owner is health_rpc_executor, NOT a table owner.
set search_path = ''
set row_security = on
as $$
declare
  v_user_id uuid := auth.uid();
  v_today date := (pg_catalog.now() at time zone 'Asia/Tokyo')::date;
  v_entry jsonb;
  v_kind text;
  v_date date;
  v_value numeric; -- no typmod: validate precision BEFORE any narrowing cast
  v_normalized jsonb := '[]'::jsonb;
  v_canonical jsonb;
  v_hash text;
  v_previous_hash text;
  v_already_processed boolean := false;
  v_group record;
  v_weights jsonb;
  v_periods jsonb;
  v_missing jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = 'P1003', message = 'HEALTH_AUTH_REQUIRED';
  end if;
  if not exists (select 1 from public.health_beta_users where user_id = v_user_id) then
    raise exception using errcode = 'P1003', message = 'HEALTH_BETA_REQUIRED';
  end if;
  if p_entries is null or pg_catalog.jsonb_typeof(p_entries) <> 'array' then
    raise exception using errcode = 'P1002', message = 'HEALTH_INVALID_PAYLOAD';
  end if;
  if pg_catalog.octet_length(p_entries::text) > 8192
      or pg_catalog.jsonb_array_length(p_entries) not between 1 and 8 then
    raise exception using errcode = 'P1002', message = 'HEALTH_INVALID_PAYLOAD';
  end if;

  for v_entry in select value from pg_catalog.jsonb_array_elements(p_entries)
  loop
    if pg_catalog.jsonb_typeof(v_entry) <> 'object'
      or (v_entry - array['type', 'occurred_on', 'value', 'unit']::text[]) <> '{}'::jsonb
      or pg_catalog.jsonb_typeof(v_entry->'type') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_entry->'occurred_on') is distinct from 'string' then
      raise exception using errcode = 'P1002', message = 'HEALTH_INVALID_ENTRY';
    end if;
    v_kind := v_entry->>'type';
    if v_kind not in ('weight', 'body_fat', 'period_start')
      or (v_entry->>'occurred_on') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception using errcode = 'P1002', message = 'HEALTH_INVALID_ENTRY';
    end if;
    begin
      v_date := (v_entry->>'occurred_on')::date;
    exception when others then
      raise exception using errcode = 'P1002', message = 'HEALTH_INVALID_DATE';
    end;
    -- Positive four-digit calendar year, exact ISO form, no guessed relative date.
    if v_date > v_today or pg_catalog.to_char(v_date, 'YYYY-MM-DD') <> v_entry->>'occurred_on' then
      raise exception using errcode = 'P1002', message = 'HEALTH_INVALID_DATE';
    end if;

    if v_kind = 'period_start' then
      if v_entry ? 'value' or v_entry ? 'unit' then
        raise exception using errcode = 'P1002', message = 'HEALTH_INVALID_ENTRY';
      end if;
      v_normalized := v_normalized || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('type', v_kind, 'occurred_on', pg_catalog.to_char(v_date, 'YYYY-MM-DD'))
      );
    else
      if pg_catalog.jsonb_typeof(v_entry->'value') is distinct from 'number'
        or pg_catalog.jsonb_typeof(v_entry->'unit') is distinct from 'string' then
        raise exception using errcode = 'P1002', message = 'HEALTH_INVALID_VALUE';
      end if;
      -- JSONB numbers are finite numerics. Validate without casting to numeric(5,1/2).
      v_value := (v_entry->>'value')::numeric;
      if v_kind = 'weight' then
        if v_entry->>'unit' <> 'kg' or not (v_value > 0 and v_value <= 500.0) then
          raise exception using errcode = 'P1002', message = 'HEALTH_INVALID_VALUE';
        end if;
        if v_value <> pg_catalog.trunc(v_value, 1) then
          raise exception using errcode = 'P1002', message = 'HEALTH_PRECISION_MISMATCH';
        end if;
        v_value := v_value::numeric(5,1); -- now safe, no value is rounded
      else
        if v_entry->>'unit' <> '%' or not (v_value > 0 and v_value <= 100.00) then
          raise exception using errcode = 'P1002', message = 'HEALTH_INVALID_VALUE';
        end if;
        if v_value <> pg_catalog.trunc(v_value, 2) then
          raise exception using errcode = 'P1002', message = 'HEALTH_PRECISION_MISMATCH';
        end if;
        v_value := v_value::numeric(5,2);
      end if;
      -- Stable decimal formatting in canonical payload, independent of input trailing zeroes.
      v_normalized := v_normalized || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'type', v_kind, 'occurred_on', pg_catalog.to_char(v_date, 'YYYY-MM-DD'),
          'value', case when v_kind = 'weight'
            then pg_catalog.to_char(v_value, 'FM9990.0')
            else pg_catalog.to_char(v_value, 'FM990.00') end,
          'unit', v_entry->>'unit'
        )
      );
    end if;
  end loop;

  if exists (
    select 1 from pg_catalog.jsonb_array_elements(v_normalized) n
    group by n->>'type', n->>'occurred_on' having pg_catalog.count(*) > 1
  ) then
    raise exception using errcode = 'P1002', message = 'HEALTH_DUPLICATE_ENTRY';
  end if;
  if p_request_id is null then
    raise exception using errcode = 'P1002', message = 'HEALTH_REQUEST_ID_REQUIRED';
  end if;
  select pg_catalog.jsonb_build_object('version', 1, 'entries',
    pg_catalog.jsonb_agg(n order by n->>'occurred_on', n->>'type'))
  into v_canonical from pg_catalog.jsonb_array_elements(v_normalized) n;
  v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_canonical::text, 'UTF8')), 'hex');

  -- Serializes only this authenticated user's request ID. Hash collisions only add contention.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':' || p_request_id::text, 0)
  );
  select payload_hash into v_previous_hash from public.health_save_requests
    where user_id = v_user_id and request_id = p_request_id;
  if found then
    if v_previous_hash <> v_hash then
      raise exception using errcode = 'P1001', message = 'HEALTH_REQUEST_CONFLICT';
    end if;
    v_already_processed := true;
    -- DO NOT recreate any weight or menstrual row in the replay branch.
  else
    for v_group in
      select (n->>'occurred_on')::date as occurred_on,
        pg_catalog.bool_or(n->>'type' = 'weight') as has_weight,
        pg_catalog.bool_or(n->>'type' = 'body_fat') as has_body_fat,
        pg_catalog.max((n->>'value')::numeric) filter (where n->>'type' = 'weight') as weight,
        pg_catalog.max((n->>'value')::numeric) filter (where n->>'type' = 'body_fat') as body_fat
      from pg_catalog.jsonb_array_elements(v_normalized) n
      where n->>'type' in ('weight', 'body_fat')
      group by n->>'occurred_on' order by n->>'occurred_on'
    loop
      insert into public.weight_records as existing (user_id, recorded_date, weight, body_fat_percentage)
        values (v_user_id, v_group.occurred_on, v_group.weight, v_group.body_fat)
      on conflict (user_id, recorded_date) do update set
        weight = case when v_group.has_weight then excluded.weight else existing.weight end,
        body_fat_percentage = case when v_group.has_body_fat then excluded.body_fat_percentage else existing.body_fat_percentage end;
      -- Keep id, created_at, bmi and all unrequested columns. No daily_records or profiles writes.
    end loop;

    insert into public.menstrual_starts (user_id, started_on)
      select v_user_id, (n->>'occurred_on')::date
      from pg_catalog.jsonb_array_elements(v_normalized) n
      where n->>'type' = 'period_start' order by n->>'occurred_on'
      on conflict (user_id, started_on) do nothing;

    insert into public.health_save_requests (user_id, request_id, payload_hash)
      values (v_user_id, p_request_id, v_hash);
  end if;

  -- COALESCE/CASE are SQL expressions, not unqualified function references.
  -- Re-read CURRENT canonical rows. The receipt contains no saved health snapshot.
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', w.id, 'recorded_date', w.recorded_date,
    'weight', w.weight, 'body_fat_percentage', w.body_fat_percentage
  ) order by w.recorded_date), '[]'::jsonb)
  into v_weights from public.weight_records w
  where w.user_id = v_user_id and exists (
    select 1 from pg_catalog.jsonb_array_elements(v_normalized) n
    where n->>'type' in ('weight', 'body_fat') and (n->>'occurred_on')::date = w.recorded_date
  );
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', m.id, 'started_on', m.started_on, 'updated_at', m.updated_at
  ) order by m.started_on), '[]'::jsonb)
  into v_periods from public.menstrual_starts m
  where m.user_id = v_user_id and exists (
    select 1 from pg_catalog.jsonb_array_elements(v_normalized) n
    where n->>'type' = 'period_start' and (n->>'occurred_on')::date = m.started_on
  );
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'type', n->>'type', 'occurred_on', n->>'occurred_on'
  ) order by n->>'occurred_on', n->>'type'), '[]'::jsonb)
  into v_missing from pg_catalog.jsonb_array_elements(v_normalized) n
  where (n->>'type' = 'period_start' and not exists (
    select 1 from public.menstrual_starts m where m.user_id = v_user_id and m.started_on = (n->>'occurred_on')::date
  )) or (n->>'type' in ('weight', 'body_fat') and not exists (
    select 1 from public.weight_records w where w.user_id = v_user_id and w.recorded_date = (n->>'occurred_on')::date
      and case when n->>'type' = 'weight' then w.weight is not null else w.body_fat_percentage is not null end
  ));
  return pg_catalog.jsonb_build_object(
    'already_processed', v_already_processed, 'weight_records', v_weights,
    'menstrual_starts', v_periods, 'missing_entries', v_missing
  );
exception
  when sqlstate 'P1001' or sqlstate 'P1002' or sqlstate 'P1003' then
    raise; -- These are our own fixed, non-health messages only.
  when others then
    -- Never copy SQLERRM, DETAIL, failing row, input, or user identifier into the API error.
    raise exception using errcode = 'P1004', message = 'HEALTH_SAVE_FAILED';
end;
$;
-- Revoke immediately after creation, in this SAME transaction: no PUBLIC window.
revoke all on function public.save_health_entries_mvp02(uuid, jsonb)
  from public, anon, authenticated, service_role;

-- Owner must NOT own the tables or have BYPASSRLS. No login/membership for app users.
-- ALTER OWNER may require installer role membership; test in an isolated DB first.
-- Temporary CREATE is revoked within this same transaction, before commit.
grant create on schema public to health_rpc_executor;
alter function public.save_health_entries_mvp02(uuid, jsonb) owner to health_rpc_executor;
revoke create on schema public from health_rpc_executor;
grant execute on function public.save_health_entries_mvp02(uuid, jsonb) to authenticated;
-- Confirm no schema CREATE survives via PUBLIC; no table ownership/RLS bypass.
do $
begin
  if pg_catalog.has_schema_privilege('health_rpc_executor', 'public', 'CREATE') then
    raise exception 'MVP02_EXECUTOR_SCHEMA_CREATE_UNSAFE';
  end if;
  if exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_roles r on r.oid = c.relowner
    where n.nspname = 'public'
      and c.relname in ('weight_records', 'health_beta_users', 'menstrual_starts', 'health_save_requests')
      and (r.rolname = 'health_rpc_executor' or not c.relrowsecurity)
  ) then
    raise exception 'MVP02_EXECUTOR_RLS_CONFIGURATION_UNSAFE';
  end if;
end $;
-- Do not grant EXECUTE on any elevated receipt-only helper.
-- No beta registration, request cleanup, manual COMMIT or exception swallowing.
commit;
