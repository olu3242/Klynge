import { strict as assert } from "node:assert";
import { test } from "node:test";
import { decideApproval, type Approval } from "./approvals.ts";
import { validateCheckpoint } from "./checkpoints.ts";
const approval: Approval = { approvalId: "a1", tenantId: "t1", workflowId: "w1",
  action: "rule.promote", requestedBy: "requester", status: "PENDING",
  reviewerId: null, decidedAtMs: null, expiresAtMs: 1000, revision: 0 };
test("human approval is separated, tenant-scoped and time-bound", () => {
  const input = { tenantId: "t1", reviewerId: "reviewer", reviewerAuthorized: true,
    approve: true, expectedRevision: 0, atMs: 100 };
  assert.equal(decideApproval(approval, input).kind, "APPLIED");
  assert.deepEqual(decideApproval(approval, { ...input, reviewerId: "requester" }), { kind: "REJECTED", reason: "SELF_APPROVAL_FORBIDDEN" });
  assert.deepEqual(decideApproval(approval, { ...input, tenantId: "t2" }), { kind: "REJECTED", reason: "TENANT_MISMATCH" });
  assert.deepEqual(decideApproval(approval, { ...input, reviewerAuthorized: false }), { kind: "REJECTED", reason: "REVIEWER_NOT_AUTHORIZED" });
  assert.deepEqual(decideApproval(approval, { ...input, atMs: 1000 }), { kind: "REJECTED", reason: "APPROVAL_EXPIRED" });
});
test("checkpoints require evidence hash", () => {
  assert.equal(validateCheckpoint({ tenantId: "t1", workflowId: "w1", stepId: "verify",
    revision: 1, evidenceIds: ["e1"], outputHash: "a".repeat(64), completedAtMs: 123 }), true);
  assert.equal(validateCheckpoint({ tenantId: "t1", workflowId: "w1", stepId: "verify",
    revision: 1, evidenceIds: [], outputHash: "invalid", completedAtMs: 123 }), false);
});
