import { strict as assert } from "node:assert";
import { test } from "node:test";
import { runWorkerBatch, type WorkerDependencies } from "./worker.ts";
import type { WorkflowJob } from "./queue.ts";
const job: WorkflowJob = {
  tenantId: "tenant1", workflowId: "wf1", jobId: "job1", status: "LEASED",
  attempt: 1, maxAttempts: 3, dueAtMs: 0, leaseOwner: "worker1",
  leaseUntilMs: 10000, fencingToken: 4,
};
function setup(capability: "market.read" | "risk.evaluate" = "market.read") {
  const calls: boolean[] = [];
  let executed = 0;
  const deps: WorkerDependencies = {
    queue: {
      async claim() { return [job]; },
      async finish(_t, _j, _w, token, _now, succeeded) {
        assert.equal(token, 4); calls.push(succeeded); return true;
      },
    },
    registry: new Map([["market-agent", { id: "market-agent", version: 1, capabilities: ["market.read"], maxRuntimeMs: 5000 }]]),
    async resolve() {
      return { request: { tenantId: "tenant1", workflowId: "wf1", agentId: "market-agent", capability, evidenceIds: [] }, allowedCapabilities: new Set(["market.read" as const]) };
    },
    async execute() { executed++; },
    now: () => 1000,
  };
  return { deps, calls, getExecuted: () => executed };
}
test("executes an authorized agent and acknowledges fenced success", async () => {
  const s = setup();
  assert.deepEqual(await runWorkerBatch(s.deps, "worker1"), { claimed: 1, succeeded: 1, failed: 0, leaseLost: 0, denied: 0 });
  assert.equal(s.getExecuted(), 1);
  assert.deepEqual(s.calls, [true]);
});
test("denies unauthorized capability without executing", async () => {
  const s = setup("risk.evaluate");
  assert.deepEqual(await runWorkerBatch(s.deps, "worker1"), { claimed: 1, succeeded: 0, failed: 1, leaseLost: 0, denied: 1 });
  assert.equal(s.getExecuted(), 0);
  assert.deepEqual(s.calls, [false]);
});
test("reports lost lease without claiming successful completion", async () => {
  const s = setup();
  s.deps.queue.finish = async () => false;
  const result = await runWorkerBatch(s.deps, "worker1");
  assert.equal(result.leaseLost, 1);
  assert.equal(result.succeeded, 0);
});
