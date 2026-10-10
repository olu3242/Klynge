drop function if exists public.klynge_finish_workflow_job(uuid,text,text,bigint,bigint,boolean);
drop function if exists public.klynge_claim_workflow_jobs(text,bigint,bigint,integer);
drop table if exists public.klynge_workflow_jobs;
