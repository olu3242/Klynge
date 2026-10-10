import { strict as assert } from "node:assert";
import { test } from "node:test";
import { AtomicWorkflowCompletion } from "./atomic-completion.ts";
import type { QueueRpc } from "./postgres-queue.ts";
const checkpoint = { tenantId: "t1", workflowId: "w1", stepId: "verify",
  revision: 2, evidenceIds: ["e1"], outputHash: "a".repeat(64), completedAtMs: 100 };
test("submits a single fenced atomic completion RPC", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const db: QueueRpc = { async rpc(name, args) { calls.push({ name, args }); return { data: true, error: null }; } };
  const result = await new AtomicWorkflowCompletion(db).complete({
    tenantId: "t1", jobId: "j1", workerId: "worker", fencingToken: 4,
    eventId: "event1", expectedRevision: 1, checkpoint, nowMs: 100,
  });
  assert.equal(result, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.name, "klynge_complete_workflow_step");
  assert.equal(calls[0]?.args.p_token, 4);
});
test("rejects invalid checkpoint and fails closed on RPC error", async () => {
  const db: QueueRpc = { async rpc() { return { data: null, error: { message: "down" } }; } };
  const input = { tenantId: "t1", jobId: "j1", workerId: "worker",
    fencingToken: 4, eventId: "event1", expectedRevision: 1, checkpoint, nowMs: 100 };
  await assert.rejects(() => new AtomicWorkflowCompletion(db).complete(input), /ATOMIC_COMPLETION_FAILED/);
  await assert.rejects(() => new AtomicWorkflowCompletion(db).complete({
    ...input, checkpoint: { ...checkpoint, tenantId: "other" },
  }), /INVALID_ATOMIC_COMPLETION/);
});
