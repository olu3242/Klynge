import { strict as assert } from "node:assert";
import { test } from "node:test";
import { ApprovalService, type VerifiedReviewer } from "./approval-service.ts";
import type { Approval } from "./approvals.ts";
const prior: Approval = {
  approvalId: "a1", tenantId: "t1", workflowId: "w1",
  action: "rule.promote", requestedBy: "author", status: "PENDING",
  reviewerId: null, decidedAtMs: null, expiresAtMs: 1000, revision: 0,
};
function make(reviewer: VerifiedReviewer | null, saved = true) {
  let writes = 0;
  const service = new ApprovalService(
    { authenticate: async () => reviewer },
    { load: async () => prior, decide: async () => { writes++; return saved; } },
  );
  return { service, writes: () => writes };
}
const reviewer: VerifiedReviewer = { userId: "reviewer", tenantId: "t1", roles: ["workflow.approve"], verified: true };
const command = { tenantId: "t1", approvalId: "a1", approve: true, expectedRevision: 0, atMs: 100 };
test("requires verified session, tenant match and server role", async () => {
  for (const identity of [null, { ...reviewer, tenantId: "t2" },
    { ...reviewer, roles: [] }]) {
    const { service, writes } = make(identity);
    assert.equal((await service.decide(command)).kind, "DENIED");
    assert.equal(writes(), 0);
  }
});
test("prevents self approval and stale writes", async () => {
  assert.equal((await make({ ...reviewer, userId: "author" }).service.decide(command)).kind, "DENIED");
  assert.deepEqual(await make(reviewer, false).service.decide(command), { kind: "DENIED", reason: "CONCURRENT_UPDATE" });
});
test("persists an authorized independent decision", async () => {
  const { service, writes } = make(reviewer);
  assert.deepEqual(await service.decide(command), { kind: "APPLIED" });
  assert.equal(writes(), 1);
});
