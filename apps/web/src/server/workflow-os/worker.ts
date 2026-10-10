import type { WorkflowJob } from "./queue.ts";
import type { Checkpoint } from "./checkpoints.ts";
import { maintainLease, type LeaseClock, type LeaseRenewer } from "./heartbeat.ts";
import { authorizeAgent, type AgentCapability, type AgentDefinition, type AgentRequest } from "./agent-runtime.ts";

/** Worker contract: the backing queue MUST atomically claim and fence acknowledgements.
 * Handlers should be idempotent. No brokerage/order execution capability exists.
 */
export interface WorkerQueue {
  claim(workerId: string, nowMs: number, leaseMs: number, limit: number): Promise<readonly WorkflowJob[]>;
  finish(tenantId: string, jobId: string, workerId: string, fencingToken: number, nowMs: number, succeeded: boolean): Promise<boolean>;
}
export interface WorkerAssignment {
  request: AgentRequest;
  allowedCapabilities: ReadonlySet<AgentCapability>;
}
export interface WorkerDependencies {
  queue: WorkerQueue;
  registry: ReadonlyMap<string, AgentDefinition>;
  resolve(job: WorkflowJob): Promise<WorkerAssignment | null>;
  execute(job: WorkflowJob, assignment: WorkerAssignment, signal: AbortSignal): Promise<void>;
  /** Required for persisted workflow steps; never use standalone finish() on success. */
  atomic?: {
    prepare(job: WorkflowJob, assignment: WorkerAssignment): Promise<{ eventId: string; expectedRevision: number; checkpoint: Checkpoint }>;
    complete(input: { tenantId: string; jobId: string; workerId: string; fencingToken: number; eventId: string; expectedRevision: number; checkpoint: Checkpoint; nowMs: number }): Promise<boolean>;
  };
  now(): number;
  lease?: { renewer: LeaseRenewer; clock: LeaseClock; intervalMs: number };
}
export interface WorkerReport {
  claimed: number;
  succeeded: number;
  failed: number;
  leaseLost: number;
  denied: number;
}
export async function runWorkerBatch(
  deps: WorkerDependencies,
  workerId: string,
  leaseMs = 30000,
  limit = 10,
): Promise<WorkerReport> {
  if (!workerId.trim() || !Number.isSafeInteger(leaseMs) || leaseMs < 1000 ||
      leaseMs > 900000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new Error("INVALID_WORKER_CONFIGURATION");
  const jobs = await deps.queue.claim(workerId, deps.now(), leaseMs, limit);
  const report: WorkerReport = { claimed: jobs.length, succeeded: 0, failed: 0, leaseLost: 0, denied: 0 };
  for (const job of jobs) {
    let success = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1, Math.min(leaseMs - 100, 300000)));
    const heartbeatStop = new AbortController();
    let leaseLost = false;
    let heartbeat: Promise<void> | null = null;
    try {
      if (job.status !== "LEASED" || job.leaseOwner !== workerId ||
          job.leaseUntilMs === null || job.leaseUntilMs <= deps.now())
        throw new Error("INVALID_CLAIM");
      if (deps.lease) {
        const lease = deps.lease;
        heartbeat = maintainLease({ job, workerId, extendMs: leaseMs,
          intervalMs: lease.intervalMs, clock: lease.clock, renewer: lease.renewer,
          signal: heartbeatStop.signal,
          onLeaseLost: () => { leaseLost = true; controller.abort(); },
        }).catch(() => { leaseLost = true; controller.abort(); });
      }
      const assignment = await deps.resolve(job);
      if (!assignment || assignment.request.tenantId !== job.tenantId ||
          assignment.request.workflowId !== job.workflowId) {
        report.denied++;
      } else {
        const verdict = authorizeAgent(deps.registry, assignment.request, assignment.allowedCapabilities);
        if (verdict.kind === "AUTHORIZED") {
          await deps.execute(job, assignment, controller.signal);
          if (controller.signal.aborted || leaseLost) throw new Error("DEADLINE_OR_LEASE_LOST");
          success = true;
        } else report.denied++;
      }
    } catch {
      // Fail closed. Do not expose tenant data or agent inputs in worker telemetry.
    } finally {
      clearTimeout(timeout);
      heartbeatStop.abort();
      if (heartbeat) await heartbeat;
    }
    if (leaseLost) success = false;
    let acknowledged = false;
    try {
      if (success && deps.atomic) {
        const assignment = await deps.resolve(job);
        if (!assignment || assignment.request.tenantId !== job.tenantId ||
          assignment.request.workflowId !== job.workflowId) throw new Error("INVALID_ATOMIC_ASSIGNMENT");
        const prepared = await deps.atomic.prepare(job, assignment);
        acknowledged = await deps.atomic.complete({ tenantId: job.tenantId, jobId: job.jobId,
          workerId, fencingToken: job.fencingToken, ...prepared, nowMs: deps.now() });
      } else if (success) {
        // A successful workflow must commit its checkpoint and job atomically.
        // Legacy uncheckpointed execution cannot be acknowledged as success.
        acknowledged = await deps.queue.finish(job.tenantId, job.jobId, workerId, job.fencingToken, deps.now(), false);
        success = false;
      } else {
        acknowledged = await deps.queue.finish(job.tenantId, job.jobId, workerId, job.fencingToken, deps.now(), false);
      }
    } catch {
      // Fail closed: lease expiration will allow recovery; do not mark success.
      report.failed++;
      continue;
    }
    if (!acknowledged) report.leaseLost++;
    else if (success) report.succeeded++;
    else report.failed++;
  }
  return report;
}
