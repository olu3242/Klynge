-- Klynge 0.6.0 (production-calibration-v1): account-scoped records kept SEPARATE from engine decisions.
-- NOT APPLIED AUTOMATICALLY. Apply after 0001, only with explicit approval, then run `npm run rls:hosted -- --confirm`.
--   user preferences · policy verdicts (vetoes) · notification preferences + outbox · audit log
-- Preferences only restrict; they never modify klynge_decisions. Notifications can only target the caller's own
-- verified email (JWT claim), so a direct API call cannot send mail to an arbitrary address.

create table if not exists public.klynge_user_policies (
  tenant_id  uuid        primary key default auth.uid() references auth.users (id) on delete cascade,
  payload    jsonb       not null check (payload ->> 'version' = '1'),
  updated_at timestamptz not null default now()
);

create table if not exists public.klynge_policy_verdicts (
  tenant_id uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  record_id text   not null,
  at        bigint not null,
  payload   jsonb  not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, record_id),
  foreign key (tenant_id, record_id) references public.klynge_decisions (tenant_id, record_id) on delete cascade,
  constraint klynge_verdict_owner check (payload ->> 'tenantId' = tenant_id::text and payload ->> 'recordId' = record_id)
);

create table if not exists public.klynge_notification_prefs (
  tenant_id  uuid        primary key default auth.uid() references auth.users (id) on delete cascade,
  payload    jsonb       not null check (payload ->> 'version' = '1'),
  updated_at timestamptz not null default now()
);

create table if not exists public.klynge_notification_outbox (
  tenant_id       uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  notification_id text   not null check (char_length(notification_id) between 8 and 64),
  status          text   not null check (status in ('PENDING', 'DELIVERED', 'FAILED', 'SUPPRESSED')),
  next_attempt_at bigint not null,
  payload         jsonb  not null,
  created_at      timestamptz not null default now(),
  primary key (tenant_id, notification_id),
  constraint klynge_outbox_payload check (payload ->> 'notificationId' = notification_id and payload ->> 'status' = status)
);
create index if not exists klynge_outbox_due on public.klynge_notification_outbox (tenant_id, status, next_attempt_at);

create table if not exists public.klynge_audit_log (
  tenant_id uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  audit_id  text   not null,
  at        bigint not null,
  action    text   not null check (action in ('auth.sign_in', 'auth.sign_out', 'session.promoted', 'policy.updated', 'notifications.updated', 'notification.delivered', 'notification.failed', 'notification.suppressed', 'data.connected')),
  detail    text   not null check (char_length(detail) <= 160),
  created_at timestamptz not null default now(),
  primary key (tenant_id, audit_id)
);
create index if not exists klynge_audit_at on public.klynge_audit_log (tenant_id, at desc);

-- Append-only: verdicts (the record of a veto at decision time) and the audit log.
drop trigger if exists klynge_verdicts_immutable on public.klynge_policy_verdicts;
create trigger klynge_verdicts_immutable before update on public.klynge_policy_verdicts for each row execute function public.klynge_forbid_update();
drop trigger if exists klynge_audit_immutable on public.klynge_audit_log;
create trigger klynge_audit_immutable before update on public.klynge_audit_log for each row execute function public.klynge_forbid_update();

revoke all on table public.klynge_user_policies, public.klynge_policy_verdicts, public.klynge_notification_prefs, public.klynge_notification_outbox, public.klynge_audit_log from anon, authenticated;
grant select, insert, update on table public.klynge_user_policies, public.klynge_notification_prefs, public.klynge_notification_outbox to authenticated;
grant select, insert on table public.klynge_policy_verdicts, public.klynge_audit_log to authenticated;

alter table public.klynge_user_policies       enable row level security;
alter table public.klynge_policy_verdicts     enable row level security;
alter table public.klynge_notification_prefs  enable row level security;
alter table public.klynge_notification_outbox enable row level security;
alter table public.klynge_audit_log           enable row level security;

create policy klynge_policies_select on public.klynge_user_policies for select to authenticated using (tenant_id = (select auth.uid()));
create policy klynge_policies_insert on public.klynge_user_policies for insert to authenticated with check (tenant_id = (select auth.uid()));
create policy klynge_policies_update on public.klynge_user_policies for update to authenticated using (tenant_id = (select auth.uid())) with check (tenant_id = (select auth.uid()));

create policy klynge_verdicts_select on public.klynge_policy_verdicts for select to authenticated using (tenant_id = (select auth.uid()));
create policy klynge_verdicts_insert on public.klynge_policy_verdicts for insert to authenticated with check (tenant_id = (select auth.uid()));

-- Notification address must be the caller's own verified email (or none).
create policy klynge_nprefs_select on public.klynge_notification_prefs for select to authenticated using (tenant_id = (select auth.uid()));
create policy klynge_nprefs_insert on public.klynge_notification_prefs for insert to authenticated
  with check (tenant_id = (select auth.uid()) and coalesce(payload -> 'email' ->> 'address', '') in ('', coalesce((select auth.jwt() ->> 'email'), '#')));
create policy klynge_nprefs_update on public.klynge_notification_prefs for update to authenticated using (tenant_id = (select auth.uid()))
  with check (tenant_id = (select auth.uid()) and coalesce(payload -> 'email' ->> 'address', '') in ('', coalesce((select auth.jwt() ->> 'email'), '#')));

create policy klynge_outbox_select on public.klynge_notification_outbox for select to authenticated using (tenant_id = (select auth.uid()));
create policy klynge_outbox_insert on public.klynge_notification_outbox for insert to authenticated
  with check (tenant_id = (select auth.uid()) and payload ->> 'to' = (select auth.jwt() ->> 'email'));
create policy klynge_outbox_update on public.klynge_notification_outbox for update to authenticated using (tenant_id = (select auth.uid()))
  with check (tenant_id = (select auth.uid()) and payload ->> 'to' = (select auth.jwt() ->> 'email'));

create policy klynge_audit_select on public.klynge_audit_log for select to authenticated using (tenant_id = (select auth.uid()));
create policy klynge_audit_insert on public.klynge_audit_log for insert to authenticated with check (tenant_id = (select auth.uid()));
