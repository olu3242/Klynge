-- STAGED ONLY: apply only after approval, RLS and role certification.
-- Atomic approval decision + WAITING_HUMAN -> READY transition.
-- Caller MUST verify reviewer identity and app_metadata authorization server-side.
create or replace function public.klynge_decide_workflow_approval(
  p_tenant uuid, p_approval text, p_reviewer text, p_expected_revision integer,
  p_workflow_revision integer, p_approve boolean, p_now bigint, p_event text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare a public.klynge_workflow_approvals%rowtype;
declare w public.klynge_workflow_instances%rowtype;
begin
  if p_tenant is null or p_approval is null or length(p_approval) not between 1 and 128
    or p_reviewer is null or length(p_reviewer) not between 1 and 128
    or p_event is null or length(p_event) not between 1 and 128
    or p_expected_revision is null or p_workflow_revision is null
    or p_now is null or p_approve is null then
    raise exception 'invalid approval decision' using errcode = '22023';
  end if;
  select * into a from public.klynge_workflow_approvals
    where tenant_id=p_tenant and approval_id=p_approval for update;
  if not found or a.status <> 'PENDING' or a.revision <> p_expected_revision
    or a.requested_by=p_reviewer or a.expires_at_ms <= p_now then return false; end if;
  select * into w from public.klynge_workflow_instances
    where tenant_id=p_tenant and workflow_id=a.workflow_id for update;
  if not found or w.status <> 'WAITING_HUMAN' or w.revision <> p_workflow_revision
    or w.updated_at_ms > p_now
    or w.processed_event_ids ? p_event then return false; end if;
  update public.klynge_workflow_approvals set
    status=case when p_approve then 'APPROVED' else 'REJECTED' end,
    reviewer_id=p_reviewer, decided_at_ms=p_now, revision=a.revision+1
    where tenant_id=p_tenant and approval_id=p_approval;
  update public.klynge_workflow_instances set
    status=case when p_approve then 'READY' else 'BLOCKED' end,
    revision=w.revision+1, updated_at_ms=p_now,
    processed_event_ids=w.processed_event_ids || jsonb_build_array(p_event),
    audit=w.audit || jsonb_build_array(jsonb_build_object(
      'eventId',p_event,'from','WAITING_HUMAN',
      'to',case when p_approve then 'READY' else 'BLOCKED' end,
      'atMs',p_now,'actor','human.reviewer','reason','approval decision'))
    where tenant_id=p_tenant and workflow_id=a.workflow_id;
  return true;
end; $$;
revoke all on function public.klynge_decide_workflow_approval(uuid,text,text,integer,integer,boolean,bigint,text)
  from public, anon, authenticated;
grant execute on function public.klynge_decide_workflow_approval(uuid,text,text,integer,integer,boolean,bigint,text)
  to service_role;
