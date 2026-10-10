import type { WorkflowJob } from "./queue.ts";
export interface LeaseRenewer {
  renew(tenantId: string, jobId: string, workerId: string, token: number, nowMs: number, extendMs: number): Promise<boolean>;
}
export interface LeaseClock { now(): number; sleep(ms: number, signal: AbortSignal): Promise<void>; }
/** Runs until stopped, aborting the handler when the lease is lost.
 * Renewals are fenced server-side; this is not an authorization bypass.
 */
export async function maintainLease(input: {
  renewer: LeaseRenewer; job: WorkflowJob; workerId: string;
  extendMs: number; intervalMs: number; clock: LeaseClock;
  signal: AbortSignal; onLeaseLost(): void;
}): Promise<void> {
  const { job, workerId, extendMs, intervalMs, clock, signal } = input;
  if (job.status !== "LEASED" || job.leaseOwner !== workerId ||
      !Number.isSafeInteger(intervalMs) || intervalMs < 100 ||
      !Number.isSafeInteger(extendMs) || extendMs < 1000 ||
      intervalMs >= extendMs) throw new Error("INVALID_HEARTBEAT");
  while (!signal.aborted) {
    try { await clock.sleep(intervalMs, signal); } catch { if (signal.aborted) break; throw new Error("HEARTBEAT_SLEEP_FAILED"); }
    if (signal.aborted) break;
    try {
      const ok = await input.renewer.renew(job.tenantId, job.jobId, workerId, job.fencingToken, clock.now(), extendMs);
      if (!ok) { input.onLeaseLost(); break; }
    } catch { input.onLeaseLost(); break; }
  }
}
