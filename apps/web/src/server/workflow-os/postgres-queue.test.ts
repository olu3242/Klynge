import { strict as assert } from "node:assert";
import { test } from "node:test";
import { PostgresWorkflowQueue, type QueueRpc } from "./postgres-queue.ts";
test("claims and finishes with explicit fencing arguments", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const rpc: QueueRpc = { async rpc(name, args) {
    calls.push({ name, args });
    if (name === "klynge_claim_workflow_jobs") return { data: [{
      tenant_id: "t1", workflow_id: "w1", job_id: "j1", status: "LEASED",
      attempt: 1, max_attempts: 3, due_at_ms: 100,
      lease_owner: "worker1", lease_until_ms: 2000, fencing_token: 7,
    }], error: null };
    return { data: true, error: null };
  } };
  const queue = new PostgresWorkflowQueue(rpc);
  const jobs = await queue.claim("worker1", 100, 1000, 1);
  assert.equal(jobs[0]?.fencingToken, 7);
  assert.equal(await queue.finish("t1", "j1", "worker1", 7, 200, true), true);
  assert.equal(calls[0]?.name, "klynge_claim_workflow_jobs");
  assert.equal(calls[1]?.args.p_token, 7);
});
test("database errors fail closed", async () => {
  const rpc: QueueRpc = { async rpc() { return { data: null, error: { message: "db unavailable" } }; } };
  await assert.rejects(() => new PostgresWorkflowQueue(rpc).claim("w", 0, 1000, 1), /CLAIM_FAILED/);
});
