-- Klynge 0.7.0 (pilot-readiness-v1): hosted notification worker. NOT APPLIED AUTOMATICALLY — apply only with explicit
-- approval after `npm run test:rls` passes (see docs/runbooks/migrations.md). Rollback: supabase/rollback/0003_*.down.sql.
--
-- Concurrency model: workers CLAIM due rows with FOR UPDATE SKIP LOCKED and a time-boxed lease (lease_owner,
-- lease_expires_at). Completion is FENCED: only the current lease owner can complete a row, so a worker that lost its
-- lease (crash, pause, overlap) cannot overwrite a newer outcome. Provider-side idempotency (Idempotency-Key =
-- notification_id) covers the crash-after-send window. Recipients must still be the tenant's CONFIRMED auth email at
-- claim time; anything else is suppressed, never sent.
-- SERVICE ROLE ≠ USER AUTHORIZATION: these functions are executable by service_role only (the allow-listed
-- "notifications.dispatch" job). Users keep their existing RLS-scoped access to their own outbox rows.

alter table public.klynge_notification_outbox add column if not exists lease_owner text check (lease_owner is null or char_length(lease_owner) between 1 and 64);
alter table public.klynge_notification_outbox add column if not exists lease_expires_at bigint;
create index if not exists klynge_outbox_claimable on public.klynge_notification_outbox (next_attempt_at) where status = 'PENDING';

-- Worker run log (infrastructure telemetry; no recipient addresses, no message content).
create table if not exists public.klynge_worker_runs (
  run_id      text   primary key check (char_length(run_id) between 8 and 64),
  worker_id   text   not null check (char_length(worker_id) between 1 and 64),
  started_at  bigint not null,
  finished_at bigint not null,
  claimed     int    not null check (claimed >= 0),
  delivered   int    not null check (delivered >= 0),
  failed      int    not null check (failed >= 0),
  deferred    int    not null check (deferred >= 0),
  suppressed  int    not null check (suppressed >= 0),
  lease_lost  int    not null check (lease_lost >= 0),
  created_at  timestamptz not null default now()
);
create index if not exists klynge_worker_runs_at on public.klynge_worker_runs (started_at desc);
revoke all on table public.klynge_worker_runs from anon, authenticated;
alter table public.klynge_worker_runs enable row level security;
-- No policies: API roles can never read or write worker runs; service_role bypasses RLS.

-- Claim up to p_limit due rows for p_worker. Unverified recipients are suppressed first (never claimed).
create or replace function public.klynge_claim_notifications(p_worker text, p_now bigint, p_lease_ms bigint, p_limit int)
returns setof public.klynge_notification_outbox
language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_lease_ms < 1000 or p_lease_ms > 900000 or p_limit < 1 or p_limit > 500 then
    raise exception 'claim: lease or batch size out of range' using errcode = '22023';
  end if;
  update public.klynge_notification_outbox o
     set status = 'SUPPRESSED',
         payload = o.payload || jsonb_build_object('status', 'SUPPRESSED', 'lastError', 'recipient is not the confirmed account email'),
         lease_owner = null, lease_expires_at = null
   where o.status = 'PENDING' and o.next_attempt_at <= p_now
     and (o.lease_expires_at is null or o.lease_expires_at <= p_now)
     and not exists (
       select 1 from auth.users u
        where u.id = o.tenant_id and u.email_confirmed_at is not null and u.email is not null and lower(u.email) = lower(o.payload ->> 'to'));
  return query
  update public.klynge_notification_outbox o
     set lease_owner = p_worker, lease_expires_at = p_now + p_lease_ms
    from (select c.tenant_id, c.notification_id from public.klynge_notification_outbox c
           where c.status = 'PENDING' and c.next_attempt_at <= p_now and (c.lease_expires_at is null or c.lease_expires_at <= p_now)
           order by c.next_attempt_at, c.created_at, c.notification_id
           limit p_limit
           for update of c skip locked) due
   where o.tenant_id = due.tenant_id and o.notification_id = due.notification_id
  returning o.*;
end $$;

-- Fenced completion: succeeds only for the current lease owner of a still-PENDING row. Recipient/identity are immutable.
create or replace function public.klynge_complete_notification(p_tenant uuid, p_notification text, p_worker text, p_status text, p_next_attempt_at bigint, p_payload jsonb)
returns boolean
language sql volatile set search_path = '' as $$
  with done as (
    update public.klynge_notification_outbox o
       set status = p_status, next_attempt_at = p_next_attempt_at, payload = p_payload, lease_owner = null, lease_expires_at = null
     where o.tenant_id = p_tenant and o.notification_id = p_notification and o.status = 'PENDING' and o.lease_owner = p_worker
       and p_status in ('PENDING', 'DELIVERED', 'FAILED', 'SUPPRESSED')
       and p_payload ->> 'to' = o.payload ->> 'to' and p_payload ->> 'notificationId' = o.notification_id and p_payload ->> 'status' = p_status
    returning 1)
  select exists (select 1 from done);
$$;

-- Per-tenant delivery context for rate limiting (no addresses returned).
create or replace function public.klynge_notification_context(p_tenant uuid, p_since bigint)
returns table (prefs jsonb, delivered_since bigint)
language sql stable set search_path = '' as $$
  select (select p.payload from public.klynge_notification_prefs p where p.tenant_id = p_tenant),
         (select count(*) from public.klynge_notification_outbox o where o.tenant_id = p_tenant and o.status = 'DELIVERED' and coalesce((o.payload ->> 'deliveredAt')::bigint, 0) >= p_since);
$$;

revoke all on function public.klynge_claim_notifications(text, bigint, bigint, int) from public, anon, authenticated;
revoke all on function public.klynge_complete_notification(uuid, text, text, text, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.klynge_notification_context(uuid, bigint) from public, anon, authenticated;
grant execute on function public.klynge_claim_notifications(text, bigint, bigint, int) to service_role;
grant execute on function public.klynge_complete_notification(uuid, text, text, text, bigint, jsonb) to service_role;
grant execute on function public.klynge_notification_context(uuid, bigint) to service_role;

-- Operator recovery actions are audited (no PII: counts only, actor recorded as the operator's own tenant row).
alter table public.klynge_audit_log drop constraint if exists klynge_audit_log_action_check;
alter table public.klynge_audit_log add constraint klynge_audit_log_action_check check (action in ('auth.sign_in', 'auth.sign_out', 'session.promoted', 'policy.updated', 'notifications.updated', 'notification.delivered', 'notification.failed', 'notification.suppressed', 'data.connected', 'ops.recovered'));
