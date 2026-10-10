import type { WorkflowJob } from "./queue.ts";
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
  now(): number;
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
    try {
      if (job.status !== "LEASED" || job.leaseOwner !== workerId ||
          job.leaseUntilMs === null || job.leaseUntilMs <= deps.now())
        throw new Error("INVALID_CLAIM");
      const assignment = await deps.resolve(job);
      if (!assignment || assignment.request.tenantId !== job.tenantId ||
          assignment.request.workflowId !== job.workflowId) {
        report.denied++;
      } else {
        const verdict = authorizeAgent(deps.registry, assignment.request, assignment.allowedCapabilities);
        if (verdict.kind === "AUTHORIZED") {
          await deps.execute(job, assignment, controller.signal);
          if (controller.signal.aborted) throw new Error("DEADLINE_EXCEEDED");
          success = true;
        } else report.denied++;
      }
    } catch {
      // Fail closed. Do not expose tenant data or agent inputs in worker telemetry.
    } finally {
      clearTimeout(timeout);
    }
    const acknowledged = await deps.queue.finish(job.tenantId, job.jobId, workerId, job.fencingToken, deps.now(), success);
    if (!acknowledged) report.leaseLost++;
    else if (success) report.succeeded++;
    else report.failed++;
  }
  return report;
}
