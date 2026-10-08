-- Rollback for 0004_klynge_pilot.sql. DESTRUCTIVE: removes pilot invites, enrollment, onboarding, feedback, triage
-- and operator audit rows. Export first (docs/runbooks/migrations.md); run only under an approved rollback.
drop table if exists public.klynge_feedback_triage;
drop table if exists public.klynge_feedback;
drop table if exists public.klynge_onboarding;
drop table if exists public.klynge_pilot_enrollment;
drop table if exists public.klynge_pilot_invites;
drop table if exists public.klynge_ops_audit;
drop function if exists public.klynge_enrollment_guard();
delete from public.klynge_audit_log where action in ('pilot.activated', 'feedback.submitted', 'account.exported');
alter table public.klynge_audit_log drop constraint if exists klynge_audit_log_action_check;
alter table public.klynge_audit_log add constraint klynge_audit_log_action_check check (action in ('auth.sign_in', 'auth.sign_out', 'session.promoted', 'policy.updated', 'notifications.updated', 'notification.delivered', 'notification.failed', 'notification.suppressed', 'data.connected', 'ops.recovered'));
