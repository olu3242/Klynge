-- Klynge 0.5.0 (auth-live-data-v1): tenant-owned chart sessions, immutable decision records, alerts, journal,
-- DATA runtime cursors. NOT APPLIED AUTOMATICALLY — apply deliberately (supabase db push / SQL editor) only after
-- `npm run test:rls` passes, then run `npm run rls:hosted`.
--
-- Constitution:
--   NO VERIFIED USER → NO DURABLE USER-OWNED MARKET SESSION   (tenant_id = auth.uid(); anon has no access)
--   SERVICE ROLE ≠ USER AUTHORIZATION                        (app user CRUD runs under the user's JWT; RLS applies)
--   VISUAL ≠ DATA                                            (VISUAL rows can never hold a directional decision)
-- Images are NEVER stored in the database. Anonymous trial state never reaches these tables.

-- ── Tables ──────────────────────────────────────────────────────────────────
create table if not exists public.klynge_sessions (
  tenant_id   uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  session_id  text        not null check (char_length(session_id) between 1 and 64),
  origin      text        not null default 'DIRECT' check (origin in ('DIRECT', 'ANONYMOUS_TRIAL')),
  payload     jsonb       not null,
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, session_id),
  constraint klynge_sessions_payload_owner check (payload ->> 'tenantId' = tenant_id::text and payload ->> 'sessionId' = session_id)
);

create table if not exists public.klynge_decisions (
  tenant_id     uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  record_id     text   not null check (char_length(record_id) between 1 and 300),
  session_id    text   not null,
  symbol        text   not null check (symbol ~ '^[A-Z][A-Z0-9.^/_-]{0,11}$|^UNKNOWN$'),
  timeframe     text,
  evidence_mode text   not null check (evidence_mode in ('VISUAL', 'DATA')),
  origin        text   not null default 'DIRECT' check (origin in ('DIRECT', 'ANONYMOUS_TRIAL')),
  at            bigint not null,
  payload       jsonb  not null,
  created_at    timestamptz not null default now(),
  primary key (tenant_id, record_id),
  constraint klynge_decisions_payload_owner check (payload ->> 'tenantId' = tenant_id::text and payload ->> 'evidenceMode' = evidence_mode),
  -- VISUAL ≠ DATA: a VISUAL row has no DATA decision and only WAIT/BLOCKED permission.
  constraint klynge_visual_not_directional check (
    evidence_mode = 'DATA'
    or ((payload -> 'data' is null or jsonb_typeof(payload -> 'data') = 'null')
        and coalesce(payload -> 'visual' ->> 'permission', 'WAIT') in ('WAIT', 'BLOCKED'))
  ),
  -- DATA rows carry an engine decision that is itself DATA evidence.
  constraint klynge_data_is_data check (evidence_mode = 'VISUAL' or payload -> 'data' ->> 'evidenceMode' = 'DATA')
);
create index if not exists klynge_decisions_symbol_at on public.klynge_decisions (tenant_id, symbol, at);
create index if not exists klynge_decisions_session_at on public.klynge_decisions (tenant_id, session_id, at);

create table if not exists public.klynge_alerts (
  tenant_id  uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  alert_id   text   not null check (char_length(alert_id) between 1 and 300),
  at         bigint not null,
  payload    jsonb  not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, alert_id),
  constraint klynge_alerts_payload check (payload ->> 'alertId' = alert_id)
);
create index if not exists klynge_alerts_at on public.klynge_alerts (tenant_id, at desc);

create table if not exists public.klynge_journal (
  tenant_id  uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  entry_id   text   not null,
  record_id  text   not null,
  symbol     text   not null,
  note       text   not null check (char_length(note) between 1 and 2000),
  author     text   not null,
  created_at bigint not null,
  primary key (tenant_id, entry_id),
  -- Composite FK: a note can only reference a decision owned by the same tenant.
  foreign key (tenant_id, record_id) references public.klynge_decisions (tenant_id, record_id) on delete cascade
);
create index if not exists klynge_journal_record on public.klynge_journal (tenant_id, record_id);

create table if not exists public.klynge_runtime_state (
  tenant_id             uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  runtime_id            text        not null check (char_length(runtime_id) between 1 and 160),
  last_market_timestamp bigint      not null,
  payload               jsonb       not null,
  updated_at            timestamptz not null default now(),
  primary key (tenant_id, runtime_id),
  constraint klynge_runtime_payload check (payload ->> 'runtimeId' = runtime_id and (payload ->> 'lastMarketTimestamp')::bigint = last_market_timestamp)
);

-- ── Append-only engine records (decisions, alerts, journal) ─────────────────
create or replace function public.klynge_forbid_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end $$;

drop trigger if exists klynge_decisions_immutable on public.klynge_decisions;
create trigger klynge_decisions_immutable before update on public.klynge_decisions for each row execute function public.klynge_forbid_update();
drop trigger if exists klynge_alerts_immutable on public.klynge_alerts;
create trigger klynge_alerts_immutable before update on public.klynge_alerts for each row execute function public.klynge_forbid_update();
drop trigger if exists klynge_journal_immutable on public.klynge_journal;
create trigger klynge_journal_immutable before update on public.klynge_journal for each row execute function public.klynge_forbid_update();

-- ── Privileges: anon gets nothing; authenticated gets only what RLS can scope ──
revoke all on table public.klynge_sessions, public.klynge_decisions, public.klynge_alerts, public.klynge_journal, public.klynge_runtime_state from anon, authenticated;
grant select, insert, update, delete on table public.klynge_sessions to authenticated;
grant select, insert on table public.klynge_decisions, public.klynge_alerts, public.klynge_journal to authenticated;
grant select, insert, update on table public.klynge_runtime_state to authenticated;

-- ── Row-level security: tenant = verified auth user ─────────────────────────
alter table public.klynge_sessions      enable row level security;
alter table public.klynge_decisions     enable row level security;
alter table public.klynge_alerts        enable row level security;
alter table public.klynge_journal       enable row level security;
alter table public.klynge_runtime_state enable row level security;

create policy klynge_sessions_select on public.klynge_sessions for select to authenticated using (tenant_id = (select auth.uid()));
create policy klynge_sessions_insert on public.klynge_sessions for insert to authenticated with check (tenant_id = (select auth.uid()));
create policy klynge_sessions_update on public.klynge_sessions for update to authenticated using (tenant_id = (select auth.uid())) with check (tenant_id = (select auth.uid()));
create policy klynge_sessions_delete on public.klynge_sessions for delete to authenticated using (tenant_id = (select auth.uid()));

create policy klynge_decisions_select on public.klynge_decisions for select to authenticated using (tenant_id = (select auth.uid()));
create policy klynge_decisions_insert on public.klynge_decisions for insert to authenticated with check (tenant_id = (select auth.uid()));

create policy klynge_alerts_select on public.klynge_alerts for select to authenticated using (tenant_id = (select auth.uid()));
create policy klynge_alerts_insert on public.klynge_alerts for insert to authenticated with check (tenant_id = (select auth.uid()));

create policy klynge_journal_select on public.klynge_journal for select to authenticated using (tenant_id = (select auth.uid()));
create policy klynge_journal_insert on public.klynge_journal for insert to authenticated with check (tenant_id = (select auth.uid()));

create policy klynge_runtime_select on public.klynge_runtime_state for select to authenticated using (tenant_id = (select auth.uid()));
create policy klynge_runtime_insert on public.klynge_runtime_state for insert to authenticated with check (tenant_id = (select auth.uid()));
create policy klynge_runtime_update on public.klynge_runtime_state for update to authenticated using (tenant_id = (select auth.uid())) with check (tenant_id = (select auth.uid()));
