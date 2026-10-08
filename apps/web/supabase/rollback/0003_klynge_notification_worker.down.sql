-- Rollback for 0003_klynge_notification_worker.sql. Drops worker functions, the worker run log and lease columns.
-- Outbox rows are preserved; in-flight leases are discarded (rows become claimable by the 0.6.0 dispatcher again).
drop function if exists public.klynge_notification_context(uuid, bigint);
drop function if exists public.klynge_complete_notification(uuid, text, text, text, bigint, jsonb);
drop function if exists public.klynge_claim_notifications(text, bigint, bigint, int);
drop table if exists public.klynge_worker_runs;
drop index if exists public.klynge_outbox_claimable;
alter table public.klynge_notification_outbox drop column if exists lease_expires_at;
alter table public.klynge_notification_outbox drop column if exists lease_owner;
delete from public.klynge_audit_log where action = 'ops.recovered';
alter table public.klynge_audit_log drop constraint if exists klynge_audit_log_action_check;
alter table public.klynge_audit_log add constraint klynge_audit_log_action_check check (action in ('auth.sign_in', 'auth.sign_out', 'session.promoted', 'policy.updated', 'notifications.updated', 'notification.delivered', 'notification.failed', 'notification.suppressed', 'data.connected'));
