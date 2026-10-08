-- Rollback for 0001_klynge_sessions.sql. DESTRUCTIVE: removes sessions, decisions, alerts, journal and runtime state.
-- Requires 0002 (and later) to be rolled back first. Export before running (docs/runbooks/migrations.md).
drop table if exists public.klynge_journal;
drop table if exists public.klynge_alerts;
drop table if exists public.klynge_runtime_state;
drop table if exists public.klynge_decisions;
drop table if exists public.klynge_sessions;
drop function if exists public.klynge_forbid_update();
