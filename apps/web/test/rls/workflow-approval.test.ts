import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { as, startPostgres, type Harness } from "./pg-harness.ts";

const T = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
let h: Harness;
const event = "approval:a1:1";
async function seed() {
  await h.pool.query("insert into auth.users(id) values ($1),($2) on conflict do nothing", [T, OTHER]);
  await h.pool.query(`insert into public.klynge_workflow_instances
    (tenant_id,workflow_id,definition_id,definition_version,status,revision,attempt,max_attempts,created_at_ms,updated_at_ms)
    values ($1,'w1','human-review',1,'WAITING_HUMAN',0,0,3,0,0)`, [T]);
  await h.pool.query(`insert into public.klynge_workflow_approvals
    (tenant_id,approval_id,workflow_id,action,requested_by,status,expires_at_ms)
    values ($1,'a1','w1','rule.promote','requester','PENDING',10000)`, [T]);
}
async function decide(tenant = T, reviewer = "reviewer", revision = 0, now = 100, approve = true) {
  return h.pool.query<{ ok: boolean }>(
    "select public.klynge_decide_workflow_approval($1::uuid,'a1',$2::text,$3::integer,0,$4::boolean,$5::bigint,$6::text) as ok",
    [tenant, reviewer, revision, approve, now, event],
  );
}
before(async () => { h = await startPostgres({ migrations: "all" }); await seed(); });
after(async () => { await h?.stop(); });
describe("Workflow approval local PostgreSQL integration", () => {
  it("revokes direct table and SECURITY DEFINER access from API roles", async () => {
    for (const table of ["klynge_workflow_instances","klynge_workflow_jobs","klynge_workflow_approvals","klynge_workflow_checkpoints"]) {
      const r = await h.pool.query("select has_table_privilege('anon',$1,'SELECT') as a, has_table_privilege('authenticated',$1,'UPDATE') as u", ["public."+table]);
      assert.deepEqual(r.rows[0], { a: false, u: false });
    }
    const r = await h.pool.query(`select has_function_privilege('authenticated',
      'public.klynge_decide_workflow_approval(uuid,text,text,integer,integer,boolean,bigint,text)', 'EXECUTE') as allowed`);
    assert.equal(r.rows[0].allowed, false);
    await assert.rejects(as(h.pool, "authenticated", T,
      "select public.klynge_decide_workflow_approval($1::uuid,'a1','reviewer',0,0,true,100,'e')", [T]), /permission denied/);
  });
  it("rejects self-approval, cross-tenant, expired and stale revisions", async () => {
    for (const [tenant, reviewer, rev, now] of [
      [T, "requester", 0, 100], [OTHER, "reviewer", 0, 100],
      [T, "reviewer", 0, 10000], [T, "reviewer", 1, 100],
    ] as const) assert.equal((await decide(tenant, reviewer, rev, now)).rows[0].ok, false);
    const r = await h.pool.query("select status, revision from public.klynge_workflow_approvals where tenant_id=$1 and approval_id='a1'", [T]);
    assert.deepEqual(r.rows[0], { status: "PENDING", revision: 0 });
  });
  it("concurrent decisions commit exactly once and replay is rejected", async () => {
    const attempts = await Promise.all([decide(), decide(), decide()]);
    assert.equal(attempts.filter(x => x.rows[0].ok).length, 1);
    assert.equal((await decide()).rows[0].ok, false);
    const a = await h.pool.query("select status, revision from public.klynge_workflow_approvals where tenant_id=$1", [T]);
    const w = await h.pool.query("select status, revision, processed_event_ids from public.klynge_workflow_instances where tenant_id=$1", [T]);
    assert.deepEqual(a.rows[0], { status: "APPROVED", revision: 1 });
    assert.equal(w.rows[0].status, "READY");
    assert.equal(w.rows[0].revision, 1);
    assert.deepEqual(w.rows[0].processed_event_ids, [event]);
  });
});
