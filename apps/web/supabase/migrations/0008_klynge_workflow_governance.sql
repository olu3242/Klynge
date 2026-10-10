-- STAGED ONLY. Depends on 0005. No automatic hosted execution.
-- Runtime-only governance tables: no direct grants to authenticated clients.
create table if not exists public.klynge_workflow_approvals (
  tenant_id uuid not null,
  approval_id text not null check (char_length(approval_id) between 1 and 128),
  workflow_id text not null,
  action text not null check (char_length(action) between 1 and 128),
  requested_by text not null check (char_length(requested_by) between 1 and 128),
  status text not null check (status in ('PENDING','APPROVED','REJECTED')),
  reviewer_id text,
  decided_at_ms bigint,
  expires_at_ms bigint not null,
  revision integer not null default 0 check (revision >= 0),
  primary key (tenant_id, approval_id),
  foreign key (tenant_id, workflow_id) references public.klynge_workflow_instances(tenant_id,workflow_id) on delete cascade,
  check ((status = 'PENDING' and reviewer_id is null and decided_at_ms is null)
    or (status <> 'PENDING' and reviewer_id is not null and decided_at_ms is not null)),
  check (reviewer_id is null or reviewer_id <> requested_by)
);
create table if not exists public.klynge_workflow_checkpoints (
  tenant_id uuid not null,
  workflow_id text not null,
  step_id text not null check (char_length(step_id) between 1 and 128),
  revision integer not null check (revision >= 0),
  evidence_ids jsonb not null check (jsonb_typeof(evidence_ids) = 'array'),
  output_hash text not null check (output_hash ~ '^[0-9a-f]{64}$'),
  completed_at_ms bigint not null,
  primary key (tenant_id, workflow_id, step_id),
  foreign key (tenant_id, workflow_id) references public.klynge_workflow_instances(tenant_id,workflow_id) on delete cascade
);
alter table public.klynge_workflow_approvals enable row level security;
alter table public.klynge_workflow_checkpoints enable row level security;
revoke all on public.klynge_workflow_approvals from anon, authenticated;
revoke all on public.klynge_workflow_checkpoints from anon, authenticated;
-- Server must independently verify reviewer identity and authorization before any write.
