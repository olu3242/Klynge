-- Klynge 0.8.0 (pilot-operations-v1): invite-only pilot enrollment, onboarding progress, structured feedback,
-- feedback triage and the operator audit trail. NOT APPLIED AUTOMATICALLY — explicit approval only, after
-- `npm run test:rls` (docs/runbooks/migrations.md). Rollback: supabase/rollback/0004_klynge_pilot.down.sql.
--
-- Invariants:
--   * Invitations and lifecycle changes (SUSPENDED / COMPLETED / reinstatement) are operator actions (service role,
--     allow-listed "pilot.admin"). A user can only ACTIVATE their own enrollment, only from a pending invite
--     addressed to their CONFIRMED email, and only with a risk acknowledgement and consent.
--   * Feedback is append-only, owned by the user and can never touch decision rows. User-reported problems are
--     triaged separately (service role) — a report is never itself a verified defect.
--   * Operator audit rows carry hashed operator refs and counts only (no PII).

create table if not exists public.klynge_pilot_invites (
  email_lower text   primary key check (email_lower = lower(email_lower) and char_length(email_lower) between 3 and 254),
  cohort      text   not null default 'pilot-1' check (char_length(cohort) between 1 and 32),
  invited_at  bigint not null,
  revoked_at  bigint,
  created_at  timestamptz not null default now()
);

create table if not exists public.klynge_pilot_enrollment (
  tenant_id        uuid   primary key default auth.uid() references auth.users (id) on delete cascade,
  status           text   not null check (status in ('ACTIVE', 'SUSPENDED', 'COMPLETED')),
  cohort           text   not null,
  activated_at     bigint not null,
  risk_ack_version text   not null check (char_length(risk_ack_version) between 1 and 32),
  consent_version  text   not null check (char_length(consent_version) between 1 and 32),
  status_changed_at bigint not null,
  status_reason    text   check (status_reason is null or char_length(status_reason) <= 160),
  updated_at       timestamptz not null default now()
);

create table if not exists public.klynge_onboarding (
  tenant_id  uuid   primary key default auth.uid() references auth.users (id) on delete cascade,
  payload    jsonb  not null check (payload ->> 'version' = '1'),
  updated_at timestamptz not null default now()
);

create table if not exists public.klynge_feedback (
  tenant_id   uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  feedback_id text   not null check (char_length(feedback_id) between 8 and 64),
  session_id  text   check (session_id is null or char_length(session_id) <= 64),
  record_id   text   check (record_id is null or char_length(record_id) <= 300),
  at          bigint not null,
  payload     jsonb  not null check (payload ->> 'kind' = 'USER_REPORTED' and pg_column_size(payload) <= 8192),
  created_at  timestamptz not null default now(),
  primary key (tenant_id, feedback_id)
);

create table if not exists public.klynge_feedback_triage (
  tenant_id   uuid   not null,
  feedback_id text   not null,
  status      text   not null check (status in ('NEW', 'ACKNOWLEDGED', 'DEFECT_CONFIRMED', 'NOT_A_DEFECT', 'NEEDS_INFO')),
  defect_ref  text   check (defect_ref is null or defect_ref ~ '^KLY-[0-9]{1,6}$'),
  reviewer    text   not null check (reviewer ~ '^op_[0-9a-f]{12}$'),
  at          bigint not null,
  primary key (tenant_id, feedback_id),
  foreign key (tenant_id, feedback_id) references public.klynge_feedback (tenant_id, feedback_id) on delete cascade
);

create table if not exists public.klynge_ops_audit (
  audit_id text   primary key check (char_length(audit_id) between 8 and 64),
  at       bigint not null,
  operator text   not null check (operator ~ '^op_[0-9a-f]{12}$'),
  action   text   not null check (action in ('pilot.invited', 'pilot.revoked', 'pilot.suspended', 'pilot.reinstated', 'pilot.completed', 'feedback.triaged', 'notification.requeued', 'runtime.quarantined', 'release.viewed')),
  detail   text   not null check (char_length(detail) <= 160),
  created_at timestamptz not null default now()
);

-- Users may move ONLY INVITED → ACTIVE (the insert); every later change is an operator action.
create or replace function public.klynge_enrollment_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'pilot enrollment status is operator-managed' using errcode = '42501';
  end if;
  if new.tenant_id <> old.tenant_id or new.activated_at <> old.activated_at or new.risk_ack_version <> old.risk_ack_version or new.consent_version <> old.consent_version then
    raise exception 'pilot enrollment identity and consent are immutable' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists klynge_enrollment_guard on public.klynge_pilot_enrollment;
create trigger klynge_enrollment_guard before update on public.klynge_pilot_enrollment for each row execute function public.klynge_enrollment_guard();

drop trigger if exists klynge_feedback_immutable on public.klynge_feedback;
create trigger klynge_feedback_immutable before update on public.klynge_feedback for each row execute function public.klynge_forbid_update();
drop trigger if exists klynge_ops_audit_immutable on public.klynge_ops_audit;
create trigger klynge_ops_audit_immutable before update on public.klynge_ops_audit for each row execute function public.klynge_forbid_update();

revoke all on table public.klynge_pilot_invites, public.klynge_pilot_enrollment, public.klynge_onboarding, public.klynge_feedback, public.klynge_feedback_triage, public.klynge_ops_audit from anon, authenticated;
grant select on table public.klynge_pilot_invites to authenticated;
grant select, insert on table public.klynge_pilot_enrollment to authenticated;
grant select, insert, update on table public.klynge_onboarding to authenticated;
grant select, insert on table public.klynge_feedback to authenticated;

alter table public.klynge_pilot_invites    enable row level security;
alter table public.klynge_pilot_enrollment enable row level security;
alter table public.klynge_onboarding       enable row level security;
alter table public.klynge_feedback         enable row level security;
alter table public.klynge_feedback_triage  enable row level security;
alter table public.klynge_ops_audit        enable row level security;

-- A user sees only the invite addressed to their own JWT email.
create policy klynge_invites_select on public.klynge_pilot_invites for select to authenticated
  using (email_lower = lower(coalesce((select auth.jwt() ->> 'email'), '#')));

create policy klynge_enrollment_select on public.klynge_pilot_enrollment for select to authenticated using (tenant_id = (select auth.uid()));
create policy klynge_enrollment_activate on public.klynge_pilot_enrollment for insert to authenticated
  with check (
    tenant_id = (select auth.uid()) and status = 'ACTIVE' and status_reason is null
    and exists (select 1 from public.klynge_pilot_invites i
                 where i.email_lower = lower(coalesce((select auth.jwt() ->> 'email'), '#')) and i.revoked_at is null and i.cohort = klynge_pilot_enrollment.cohort));
-- No update grant or policy for users: every later status change is an operator action (guard trigger defends identity).

create policy klynge_onboarding_select on public.klynge_onboarding for select to authenticated using (tenant_id = (select auth.uid()));
create policy klynge_onboarding_insert on public.klynge_onboarding for insert to authenticated with check (tenant_id = (select auth.uid()));
create policy klynge_onboarding_update on public.klynge_onboarding for update to authenticated using (tenant_id = (select auth.uid())) with check (tenant_id = (select auth.uid()));

create policy klynge_feedback_select on public.klynge_feedback for select to authenticated using (tenant_id = (select auth.uid()));
create policy klynge_feedback_insert on public.klynge_feedback for insert to authenticated with check (tenant_id = (select auth.uid()));
-- klynge_feedback_triage and klynge_ops_audit: no policies — API roles have no access; operators use the service role.

-- User audit actions for the pilot (counts/labels only; never content).
alter table public.klynge_audit_log drop constraint if exists klynge_audit_log_action_check;
alter table public.klynge_audit_log add constraint klynge_audit_log_action_check check (action in ('auth.sign_in', 'auth.sign_out', 'session.promoted', 'policy.updated', 'notifications.updated', 'notification.delivered', 'notification.failed', 'notification.suppressed', 'data.connected', 'ops.recovered', 'pilot.activated', 'feedback.submitted', 'account.exported'));
