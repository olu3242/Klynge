import { strict as assert } from "node:assert";
import { test } from "node:test";
import { AtomicApprovalTransition } from "./approval-transition.ts";
import type { QueueRpc } from "./postgres-queue.ts";
const valid = { tenantId: "t1", approvalId: "a1", reviewerId: "reviewer",
  approvalRevision: 0, workflowRevision: 4, approve: true, nowMs: 100, eventId: "e1" };
test("atomic approval passes revision and event fencing in one RPC", async () => {
  const calls: Record<string, unknown>[] = [];
  const db: QueueRpc = { async rpc(_name, args) { calls.push(args); return { data: true, error: null }; } };
  assert.equal(await new AtomicApprovalTransition(db).decide(valid), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.p_workflow_revision, 4);
  assert.equal(calls[0]?.p_reviewer, "reviewer");
});
test("replay/concurrent conflict returns false, database failure denies", async () => {
  const denied: QueueRpc = { async rpc() { return { data: false, error: null }; } };
  assert.equal(await new AtomicApprovalTransition(denied).decide(valid), false);
  const down: QueueRpc = { async rpc() { return { data: null, error: { message: "offline" } }; } };
  await assert.rejects(() => new AtomicApprovalTransition(down).decide(valid), /APPROVAL_TRANSITION_FAILED/);
  await assert.rejects(() => new AtomicApprovalTransition(denied).decide({ ...valid, workflowRevision: -1 }), /INVALID_APPROVAL_TRANSITION/);
});
