import { strict as assert } from "node:assert";
import { test } from "node:test";
import { leaseJob, finishJob, type WorkflowJob } from "./queue.ts";
const pending: WorkflowJob = {
  jobId: "j1", tenantId: "t1", workflowId: "w1", status: "PENDING",
  attempt: 0, maxAttempts: 2, dueAtMs: 100, leaseOwner: null, leaseUntilMs: null, fencingToken: 0,
};
test("claims due work with monotonic fencing token", () => {
  const first = leaseJob(pending, "worker1", 100, 1000);
  assert.equal(first.kind, "APPLIED");
  if (first.kind !== "APPLIED") return;
  assert.equal(first.job.fencingToken, 1);
  assert.equal(leaseJob(first.job, "worker2", 200, 1000).kind, "REJECTED");
  const reclaimed = leaseJob(first.job, "worker2", 1100, 1000);
  assert.equal(reclaimed.kind, "APPLIED");
  if (reclaimed.kind !== "APPLIED") return;
  assert.equal(reclaimed.job.fencingToken, 2);
  assert.equal(finishJob(reclaimed.job, "worker1", 1, 1200, true).kind, "REJECTED");
  assert.equal(finishJob(reclaimed.job, "worker2", 2, 1200, true).kind, "APPLIED");
});
test("retries with backoff then dead-letters", () => {
  const first = leaseJob(pending, "w", 100, 1000);
  assert.equal(first.kind, "APPLIED");
  if (first.kind !== "APPLIED") return;
  const failed = finishJob(first.job, "w", 1, 101, false);
  assert.equal(failed.kind, "APPLIED");
  if (failed.kind !== "APPLIED") return;
  assert.equal(failed.job.dueAtMs, 1101);
  const second = leaseJob(failed.job, "w", 1101, 1000);
  assert.equal(second.kind, "APPLIED");
  if (second.kind !== "APPLIED") return;
  const terminal = finishJob(second.job, "w", 2, 1102, false);
  assert.equal(terminal.kind, "APPLIED");
  if (terminal.kind === "APPLIED") assert.equal(terminal.job.status, "DEAD_LETTERED");
});
test("rejects early, expired, and invalid leases", () => {
  assert.equal(leaseJob(pending, "w", 99, 1000).kind, "REJECTED");
  assert.equal(leaseJob(pending, "w", 100, 10).kind, "REJECTED");
  const first = leaseJob(pending, "w", 100, 1000);
  if (first.kind === "APPLIED") assert.equal(finishJob(first.job, "w", 1, 1100, true).kind, "REJECTED");
});
