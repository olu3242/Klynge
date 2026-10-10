-- STAGED ONLY. Depends on 0006. Requires explicit migration and RLS approval.
-- A lease renewal is fenced by tenant, job, worker and token. It cannot revive an expired lease.
create or replace function public.klynge_renew_workflow_lease(
  p_tenant uuid, p_job text, p_worker text, p_token bigint,
  p_now bigint, p_extend_ms bigint
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare updated_count integer;
begin
  if p_extend_ms is null or p_extend_ms not between 1000 and 900000 then
    raise exception 'invalid lease extension' using errcode = '22023';
  end if;
  update public.klynge_workflow_jobs j
  set lease_until_ms = p_now + p_extend_ms
  where j.tenant_id = p_tenant and j.job_id = p_job
    and j.status = 'LEASED' and j.lease_owner = p_worker
    and j.fencing_token = p_token and j.lease_until_ms > p_now;
  get diagnostics updated_count = row_count;
  return updated_count = 1;
end; $$;
revoke all on function public.klynge_renew_workflow_lease(uuid,text,text,bigint,bigint,bigint)
  from public, anon, authenticated;
grant execute on function public.klynge_renew_workflow_lease(uuid,text,text,bigint,bigint,bigint)
  to service_role;
