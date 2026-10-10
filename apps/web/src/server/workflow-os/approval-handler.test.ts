import { strict as assert } from "node:assert";
import { test } from "node:test";
import { handleApprovalRequest } from "./approval-handler.ts";
import type { Approval } from "./approvals.ts";
const prior: Approval = { approvalId: "a1", tenantId: "t1", workflowId: "w1",
  action: "rule.promote", requestedBy: "author", status: "PENDING",
  reviewerId: null, decidedAtMs: null, expiresAtMs: 1000, revision: 0 };
test("HTTP boundary rejects malformed and unauthorized decisions", async () => {
  const auth = { authenticate: async () => null };
  const store = { load: async () => prior, decide: async () => true };
  assert.equal((await handleApprovalRequest(auth, store, {}, 100)).status, 400);
  assert.equal((await handleApprovalRequest(auth, store, {
    tenantId: "t1", approvalId: "a1", approve: true, expectedRevision: 0,
  }, 100)).status, 404);
});
test("authorized decision succeeds, stale CAS remains unavailable", async () => {
  const auth = { authenticate: async () => ({ userId: "reviewer", tenantId: "t1",
    roles: ["workflow.approve"], verified: true as const }) };
  const body = { tenantId: "t1", approvalId: "a1", approve: true, expectedRevision: 0 };
  assert.equal((await handleApprovalRequest(auth, { load: async () => prior, decide: async () => true }, body, 100)).status, 200);
  assert.equal((await handleApprovalRequest(auth, { load: async () => prior, decide: async () => false }, body, 100)).status, 404);
});
