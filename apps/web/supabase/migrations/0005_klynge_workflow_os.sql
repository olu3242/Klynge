-- Workflow OS durable instance and audit storage. STAGED ONLY; do not apply without
-- hosted backup, RLS test certification, migration approval and rollback review.
create table if not exists public.klynge_workflow_instances (
  tenant_id uuid not null references auth.users(id) on delete cascade,
  workflow_id text not null check (char_length(workflow_id) between 1 and 128),
  definition_id text not null check (char_length(definition_id) between 1 and 128),
  definition_version integer not null check (definition_version > 0),
  status text not null check (status in ('CREATED','VALIDATING','READY','RUNNING','WAITING_EXTERNAL','WAITING_HUMAN','RETRY_SCHEDULED','COMPLETED','BLOCKED','FAILED','CANCELED','DEAD_LETTERED')),
  revision integer not null check (revision >= 0),
  attempt integer not null check (attempt >= 0),
  max_attempts integer not null check (max_attempts > 0),
  created_at_ms bigint not null,
  updated_at_ms bigint not null,
  processed_event_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(processed_event_ids) = 'array'),
  audit jsonb not null default '[]'::jsonb check (jsonb_typeof(audit) = 'array'),
  primary key (tenant_id, workflow_id)
);
create index if not exists klynge_workflow_status_idx on public.klynge_workflow_instances (tenant_id, status, updated_at_ms);
alter table public.klynge_workflow_instances enable row level security;
revoke all on public.klynge_workflow_instances from anon, authenticated;
-- No direct user policies: runtime uses a server-only, allow-listed service identity.
-- All writes must pass a separately audited and authorized runtime endpoint.
