-- Rollback for 0002_klynge_account.sql. DESTRUCTIVE: removes account preferences, verdicts, outbox and audit rows.
-- Run only under an approved incident/rollback procedure, after exporting the tables (see docs/runbooks/migrations.md).
drop table if exists public.klynge_policy_verdicts;
drop table if exists public.klynge_notification_outbox;
drop table if exists public.klynge_notification_prefs;
drop table if exists public.klynge_user_policies;
drop table if exists public.klynge_audit_log;
