import { strict as assert } from "node:assert";
import { test } from "node:test";
import { MemoryWorkflowStore } from "./memory-store.ts";
import { WorkflowOrchestrator } from "./orchestrator.ts";

test("create, transition and retrieve isolated workflow", async () => {
  const store = new MemoryWorkflowStore();
  const os = new WorkflowOrchestrator(store);
  await os.create({ tenantId: "t1", workflowId: "w1", definitionId: "ticker", definitionVersion: 1, maxAttempts: 2, nowMs: 10 });
  await assert.rejects(() => os.create({ tenantId: "t1", workflowId: "w1", definitionId: "ticker", definitionVersion: 1, maxAttempts: 2, nowMs: 10 }), /ALREADY_EXISTS/);
  const result = await os.transition({ tenantId: "t1", workflowId: "w1", eventId: "e1", expectedRevision: 0, to: "VALIDATING", atMs: 11, actor: "system", reason: "start" });
  assert.equal(result.kind, "APPLIED");
  assert.equal((await store.get("t1", "w1"))?.revision, 1);
  assert.equal(await store.get("t2", "w1"), null);
});
test("rejects conflicting revisions and invalid tenant", async () => {
  const os = new WorkflowOrchestrator(new MemoryWorkflowStore());
  await os.create({ tenantId: "t1", workflowId: "w1", definitionId: "ticker", definitionVersion: 1, maxAttempts: 2, nowMs: 10 });
  const input = { tenantId: "t1", workflowId: "w1", eventId: "e1", expectedRevision: 0, to: "VALIDATING" as const, atMs: 11, actor: "system", reason: "start" };
  assert.equal((await os.transition(input)).kind, "APPLIED");
  assert.deepEqual(await os.transition({ ...input, eventId: "e2" }), { kind: "REJECTED", reason: "REVISION_CONFLICT" });
  assert.deepEqual(await os.transition({ ...input, tenantId: "t2" }), { kind: "REJECTED", reason: "NOT_FOUND" });
});
