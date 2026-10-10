-- STAGED ONLY. Approval required before applying. Depends on 0005_klynge_workflow_os.sql.
-- Workers must use the allow-listed service identity; clients receive no direct grants.
create table if not exists public.klynge_workflow_jobs (
  tenant_id uuid not null references auth.users(id) on delete cascade,
  job_id text not null check (char_length(job_id) between 1 and 128),
  workflow_id text not null,
  status text not null check (status in ('PENDING','LEASED','SUCCEEDED','DEAD_LETTERED')),
  attempt integer not null default 0 check (attempt >= 0),
  max_attempts integer not null check (max_attempts between 1 and 100),
  due_at_ms bigint not null,
  lease_owner text,
  lease_until_ms bigint,
  fencing_token bigint not null default 0 check (fencing_token >= 0),
  created_at timestamptz not null default now(),
  primary key (tenant_id, job_id),
  foreign key (tenant_id, workflow_id) references public.klynge_workflow_instances(tenant_id, workflow_id) on delete cascade,
  check ((status = 'LEASED' and lease_owner is not null and lease_until_ms is not null)
      or (status <> 'LEASED' and lease_owner is null and lease_until_ms is null))
);
create index if not exists klynge_workflow_due_jobs
  on public.klynge_workflow_jobs(due_at_ms) where status = 'PENDING';
create index if not exists klynge_workflow_expired_leases
  on public.klynge_workflow_jobs(lease_until_ms) where status = 'LEASED';
alter table public.klynge_workflow_jobs enable row level security;
revoke all on public.klynge_workflow_jobs from anon, authenticated;

-- Atomic claim with SKIP LOCKED; every claim increments the fencing token.
create or replace function public.klynge_claim_workflow_jobs(
  p_worker text, p_now bigint, p_lease_ms bigint, p_limit integer
) returns setof public.klynge_workflow_jobs
language plpgsql security definer set search_path = '' as $$
begin
  if p_worker is null or length(p_worker) not between 1 and 64 or
     p_lease_ms not between 1000 and 900000 or p_limit not between 1 and 100 then
    raise exception 'invalid workflow claim parameters' using errcode = '22023';
  end if;
  return query
  with claimable as (
    select j.tenant_id, j.job_id
    from public.klynge_workflow_jobs j
    where j.due_at_ms <= p_now and j.attempt < j.max_attempts
      and (j.status = 'PENDING' or (j.status = 'LEASED' and j.lease_until_ms <= p_now))
    order by j.due_at_ms, j.job_id
    for update skip locked limit p_limit
  )
  update public.klynge_workflow_jobs j set
    status='LEASED', attempt=j.attempt+1,
    lease_owner=p_worker, lease_until_ms=p_now+p_lease_ms,
    fencing_token=j.fencing_token+1
  from claimable c where j.tenant_id=c.tenant_id and j.job_id=c.job_id
  returning j.*;
end; $$;
revoke all on function public.klynge_claim_workflow_jobs(text,bigint,bigint,integer) from public, anon, authenticated;
grant execute on function public.klynge_claim_workflow_jobs(text,bigint,bigint,integer) to service_role;

-- Fenced completion. A stale worker cannot acknowledge a reclaimed job.
create or replace function public.klynge_finish_workflow_job(
  p_tenant uuid, p_job text, p_worker text, p_token bigint, p_now bigint, p_success boolean
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare updated_count integer;
begin
  update public.klynge_workflow_jobs j set
    status=case when p_success then 'SUCCEEDED'
      when j.attempt >= j.max_attempts then 'DEAD_LETTERED' else 'PENDING' end,
    due_at_ms=case when p_success or j.attempt >= j.max_attempts then j.due_at_ms
      else p_now + least(600000::bigint, (1000 * power(2, least(j.attempt-1,9)))::bigint) end,
    lease_owner=null, lease_until_ms=null
  where j.tenant_id=p_tenant and j.job_id=p_job and j.status='LEASED'
    and j.lease_owner=p_worker and j.fencing_token=p_token and j.lease_until_ms>p_now;
  get diagnostics updated_count = row_count;
  return updated_count=1;
end; $$;
revoke all on function public.klynge_finish_workflow_job(uuid,text,text,bigint,bigint,boolean) from public, anon, authenticated;
grant execute on function public.klynge_finish_workflow_job(uuid,text,text,bigint,bigint,boolean) to service_role;
