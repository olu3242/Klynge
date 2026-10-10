import { strict as assert } from "node:assert";
import { test } from "node:test";
import { maintainLease } from "./heartbeat.ts";
import type { WorkflowJob } from "./queue.ts";
const job: WorkflowJob = { tenantId: "t1", workflowId: "w1", jobId: "j1",
  status: "LEASED", attempt: 1, maxAttempts: 3, dueAtMs: 0,
  leaseOwner: "worker", leaseUntilMs: 10000, fencingToken: 2 };
test("heartbeat stops on lease loss and supplies fencing token", async () => {
  let lost = 0; let token = -1;
  await maintainLease({
    job, workerId: "worker", extendMs: 1000, intervalMs: 100,
    signal: new AbortController().signal,
    clock: { now: () => 100, sleep: async () => {} },
    renewer: { renew: async (_t, _j, _w, fence) => { token = fence; return false; } },
    onLeaseLost: () => { lost++; },
  });
  assert.equal(token, 2); assert.equal(lost, 1);
});
test("heartbeat rejects mismatched worker", async () => {
  await assert.rejects(() => maintainLease({
    job, workerId: "other", extendMs: 1000, intervalMs: 100,
    signal: new AbortController().signal,
    clock: { now: () => 100, sleep: async () => {} },
    renewer: { renew: async () => true }, onLeaseLost: () => {},
  }), /INVALID_HEARTBEAT/);
});
