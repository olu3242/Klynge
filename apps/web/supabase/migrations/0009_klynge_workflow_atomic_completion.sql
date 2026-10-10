-- STAGED ONLY. Depends on 0005, 0006 and 0008.
-- Atomic, fenced checkpoint + workflow completion + queue acknowledgement.
-- No automatic deployment; requires hosted RLS, rollback and concurrency certification.
create or replace function public.klynge_complete_workflow_step(
  p_tenant uuid, p_job text, p_worker text, p_token bigint, p_now bigint,
  p_event text, p_expected_revision integer, p_step text,
  p_evidence jsonb, p_output_hash text
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  j public.klynge_workflow_jobs%rowtype;
  w public.klynge_workflow_instances%rowtype;
begin
  if p_tenant is null or p_job is null or p_worker is null or p_event is null
    or p_step is null or p_output_hash !~ '^[0-9a-f]{64}$'
    or p_evidence is null or jsonb_typeof(p_evidence) <> 'array'
    or jsonb_array_length(p_evidence) > 100
    or p_now is null or p_expected_revision is null then
    raise exception 'invalid completion request' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_evidence) v
    where jsonb_typeof(v) <> 'string' or length(trim(v #>> '{}')) not between 1 and 128) then
    raise exception 'invalid evidence identifier' using errcode = '22023';
  end if;
  select * into j from public.klynge_workflow_jobs
    where tenant_id=p_tenant and job_id=p_job for update;
  if not found or j.status <> 'LEASED' or j.lease_owner <> p_worker
    or j.fencing_token <> p_token or j.lease_until_ms <= p_now then return false; end if;
  select * into w from public.klynge_workflow_instances
    where tenant_id=p_tenant and workflow_id=j.workflow_id for update;
  if not found or w.revision <> p_expected_revision or w.status <> 'RUNNING'
    or p_event = any(array(select jsonb_array_elements_text(w.processed_event_ids))) then return false; end if;
  insert into public.klynge_workflow_checkpoints
    (tenant_id,workflow_id,step_id,revision,evidence_ids,output_hash,completed_at_ms)
    values (p_tenant,j.workflow_id,p_step,w.revision+1,p_evidence,p_output_hash,p_now)
    on conflict (tenant_id,workflow_id,step_id) do nothing;
  if not found then return false; end if;
  update public.klynge_workflow_instances set
    status='COMPLETED', revision=w.revision+1, updated_at_ms=p_now,
    processed_event_ids=w.processed_event_ids || jsonb_build_array(p_event),
    audit=w.audit || jsonb_build_array(jsonb_build_object(
      'eventId',p_event,'from','RUNNING','to','COMPLETED','atMs',p_now,
      'actor','workflow.worker','reason','fenced checkpoint completion'))
    where tenant_id=p_tenant and workflow_id=j.workflow_id and revision=w.revision;
  update public.klynge_workflow_jobs set status='SUCCEEDED',lease_owner=null,lease_until_ms=null
    where tenant_id=p_tenant and job_id=p_job and fencing_token=p_token;
  return true;
end; $$;
revoke all on function public.klynge_complete_workflow_step(uuid,text,text,bigint,bigint,text,integer,text,jsonb,text)
  from public,anon,authenticated;
grant execute on function public.klynge_complete_workflow_step(uuid,text,text,bigint,bigint,text,integer,text,jsonb,text)
  to service_role;
