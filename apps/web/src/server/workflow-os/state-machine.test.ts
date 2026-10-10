import { strict as assert } from "node:assert";
import { test } from "node:test";
import { transitionWorkflow } from "./state-machine.ts";
import type { WorkflowInstance, WorkflowStatus } from "./types.ts";

const initial: WorkflowInstance = {
  workflowId: "wf_1", tenantId: "tenant_1", definitionId: "market-review",
  definitionVersion: 1, status: "CREATED", revision: 0, attempt: 0,
  maxAttempts: 2, createdAtMs: 100, updatedAtMs: 100, processedEventIds: [], audit: [],
};
function move(instance: WorkflowInstance, to: WorkflowStatus, eventId: string, overrides: Record<string, unknown> = {}) {
  return transitionWorkflow(instance, {
    tenantId: "tenant_1", eventId, expectedRevision: instance.revision,
    to, atMs: instance.updatedAtMs + 1, actor: "runtime", reason: "test", ...overrides,
  });
}
test("valid transitions are versioned and audited", () => {
  const a = move(initial, "VALIDATING", "evt_1");
  assert.equal(a.kind, "APPLIED");
  if (a.kind !== "APPLIED") return;
  assert.equal(a.instance.revision, 1);
  assert.equal(a.instance.audit[0]?.from, "CREATED");
  assert.equal(a.instance.audit[0]?.to, "VALIDATING");
  assert.equal(move(a.instance, "READY", "evt_2").kind, "APPLIED");
});
test("duplicate commands are idempotent and cross-tenant writes are denied", () => {
  const a = move(initial, "VALIDATING", "evt_1");
  assert.equal(a.kind, "APPLIED");
  if (a.kind !== "APPLIED") return;
  assert.equal(move(a.instance, "READY", "evt_1").kind, "DUPLICATE");
  assert.deepEqual(move(a.instance, "READY", "evt_2", { tenantId: "other" }), { kind: "REJECTED", reason: "TENANT_MISMATCH" });
});
test("rejects stale revisions, invalid transitions and time reversal", () => {
  assert.deepEqual(move(initial, "COMPLETED", "evt_1"), { kind: "REJECTED", reason: "INVALID_TRANSITION" });
  assert.deepEqual(move(initial, "VALIDATING", "evt_2", { expectedRevision: 3 }), { kind: "REJECTED", reason: "REVISION_CONFLICT" });
  assert.deepEqual(move(initial, "VALIDATING", "evt_3", { atMs: 99 }), { kind: "REJECTED", reason: "INVALID_TIME" });
});
test("terminal states are immutable", () => {
  const terminal = { ...initial, status: "COMPLETED" as const };
  assert.equal(move(terminal, "READY", "evt_4").kind, "REJECTED");
});
test("retry budget limits repeated executions", () => {
  const exhausted = { ...initial, status: "READY" as const, attempt: 2 };
  assert.deepEqual(move(exhausted, "RUNNING", "evt_5"), { kind: "REJECTED", reason: "RETRY_BUDGET_EXCEEDED" });
});
