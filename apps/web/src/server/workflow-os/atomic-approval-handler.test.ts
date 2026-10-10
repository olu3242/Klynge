import { strict as assert } from "node:assert";
import { test } from "node:test";
import { handleAtomicApproval } from "./atomic-approval-handler.ts";
import type { Approval } from "./approvals.ts";
import type { QueueRpc } from "./postgres-queue.ts";
const prior: Approval = { tenantId: "t1", approvalId: "a1", workflowId: "w1",
  action: "rule.promote", requestedBy: "author", status: "PENDING",
  reviewerId: null, decidedAtMs: null, expiresAtMs: 1000, revision: 0 };
const body = { tenantId: "t1", approvalId: "a1", approve: true, expectedRevision: 0 };
function setup(options: { user?: string; tenant?: string; role?: boolean; prior?: Approval; revision?: number | null; applied?: boolean } = {}) {
  const calls: Record<string, unknown>[] = [];
  const auth = { authenticate: async () => ({
    userId: options.user ?? "reviewer", tenantId: options.tenant ?? "t1",
    roles: options.role === false ? [] : ["workflow.approve"], verified: true as const,
  }) };
  const lookup = {
    load: async () => options.prior ?? prior,
    workflowRevision: async () => options.revision === undefined ? 4 : options.revision,
  };
  const rpc: QueueRpc = { async rpc(_name, args) {
    calls.push(args); return { data: options.applied ?? true, error: null };
  } };
  return { auth, lookup, rpc, calls };
}
test("authorized approval atomically advances workflow with replay key", async () => {
  const s = setup();
  assert.equal((await handleAtomicApproval(s.auth, s.lookup, s.rpc, body, 100)).status, 200);
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0]?.p_event, "approval:a1:1");
  assert.equal(s.calls[0]?.p_workflow_revision, 4);
});
test("rejects cross-tenant, self-approval, expiration, stale revision and missing role", async () => {
  for (const s of [
    setup({ tenant: "t2" }), setup({ user: "author" }), setup({ role: false }),
    setup({ prior: { ...prior, expiresAtMs: 100 } }),
    setup({ prior: { ...prior, revision: 1 } }),
    setup({ revision: null }),
  ]) {
    assert.equal((await handleAtomicApproval(s.auth, s.lookup, s.rpc, body, 100)).status, 404);
    assert.equal(s.calls.length, 0);
  }
});
test("database rejects replay or concurrent update", async () => {
  const s = setup({ applied: false });
  assert.equal((await handleAtomicApproval(s.auth, s.lookup, s.rpc, body, 100)).status, 404);
  assert.equal(s.calls.length, 1);
});
test("malformed request fails before authentication or database", async () => {
  const s = setup();
  assert.equal((await handleAtomicApproval(s.auth, s.lookup, s.rpc, { ...body, expectedRevision: -1 }, 100)).status, 400);
  assert.equal(s.calls.length, 0);
});
