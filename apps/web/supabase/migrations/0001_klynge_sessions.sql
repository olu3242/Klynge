-- Klynge 0.4.0 (visual-intake-v1): chart sessions, immutable decision records, alerts, journal.
-- Images are NEVER stored in the database. Server writes use the service role (bypasses RLS);
-- RLS below scopes any direct client access to the caller's own tenant and is read-only for records.
-- NOT applied automatically: run `supabase db push` (or the dashboard SQL editor) deliberately.

create table if not exists public.klynge_sessions (
  tenant_id   text        not null,
  session_id  text        not null,
  payload     jsonb       not null,
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, session_id)
);

create table if not exists public.klynge_decisions (
  tenant_id     text   not null,
  record_id     text   not null,
  session_id    text   not null,
  symbol        text   not null,
  timeframe     text,
  evidence_mode text   not null check (evidence_mode in ('VISUAL', 'DATA')),
  at            bigint not null,
  payload       jsonb  not null,
  created_at    timestamptz not null default now(),
  primary key (tenant_id, record_id),
  -- VISUAL records can never carry a directional decision.
  constraint klynge_visual_not_directional check (evidence_mode = 'DATA' or payload->'data' is null)
);
create index if not exists klynge_decisions_symbol_at on public.klynge_decisions (tenant_id, symbol, at);
create index if not exists klynge_decisions_session_at on public.klynge_decisions (tenant_id, session_id, at);

create table if not exists public.klynge_alerts (
  tenant_id  text   not null,
  alert_id   text   not null,
  at         bigint not null,
  payload    jsonb  not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, alert_id)
);
create index if not exists klynge_alerts_at on public.klynge_alerts (tenant_id, at desc);

create table if not exists public.klynge_journal (
  tenant_id  text   not null,
  entry_id   text   not null,
  record_id  text   not null,
  symbol     text   not null,
  note       text   not null check (char_length(note) between 1 and 2000),
  author     text   not null,
  created_at bigint not null,
  primary key (tenant_id, entry_id),
  foreign key (tenant_id, record_id) references public.klynge_decisions (tenant_id, record_id) on delete cascade
);
create index if not exists klynge_journal_record on public.klynge_journal (tenant_id, record_id);

-- Engine records and alerts are append-only (idempotent inserts use ON CONFLICT DO NOTHING).
create or replace function public.klynge_forbid_update() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name;
end $$;
drop trigger if exists klynge_decisions_immutable on public.klynge_decisions;
create trigger klynge_decisions_immutable before update on public.klynge_decisions for each row execute function public.klynge_forbid_update();
drop trigger if exists klynge_alerts_immutable on public.klynge_alerts;
create trigger klynge_alerts_immutable before update on public.klynge_alerts for each row execute function public.klynge_forbid_update();

alter table public.klynge_sessions  enable row level security;
alter table public.klynge_decisions enable row level security;
alter table public.klynge_alerts    enable row level security;
alter table public.klynge_journal   enable row level security;

-- Tenant = authenticated user. anon gets nothing.
create policy klynge_sessions_own  on public.klynge_sessions  for select to authenticated using (tenant_id = (select auth.uid())::text);
create policy klynge_decisions_own on public.klynge_decisions for select to authenticated using (tenant_id = (select auth.uid())::text);
create policy klynge_alerts_own    on public.klynge_alerts    for select to authenticated using (tenant_id = (select auth.uid())::text);
create policy klynge_journal_read  on public.klynge_journal   for select to authenticated using (tenant_id = (select auth.uid())::text);
create policy klynge_journal_write on public.klynge_journal   for insert to authenticated with check (tenant_id = (select auth.uid())::text);
