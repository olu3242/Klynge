import type { WorkflowJob } from "./queue.ts";
import type { WorkerQueue } from "./worker.ts";

/** Use only with a trusted server-side service-role RPC client.
 * The DB functions enforce atomic claim, lease expiry and fencing.
 */
export interface QueueRpc {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
}
function jobFromRow(raw: unknown): WorkflowJob {
  if (!raw || typeof raw !== "object") throw new Error("INVALID_QUEUE_ROW");
  const row = raw as Record<string, unknown>;
  const status = row.status;
  if (status !== "PENDING" && status !== "LEASED" && status !== "SUCCEEDED" && status !== "DEAD_LETTERED")
    throw new Error("INVALID_QUEUE_STATUS");
  return {
    jobId: String(row.job_id), tenantId: String(row.tenant_id), workflowId: String(row.workflow_id),
    status, attempt: Number(row.attempt), maxAttempts: Number(row.max_attempts),
    dueAtMs: Number(row.due_at_ms), leaseOwner: row.lease_owner === null ? null : String(row.lease_owner),
    leaseUntilMs: row.lease_until_ms === null ? null : Number(row.lease_until_ms),
    fencingToken: Number(row.fencing_token),
  };
}
export class PostgresWorkflowQueue implements WorkerQueue {
  constructor(private readonly db: QueueRpc) {}
  async claim(workerId: string, nowMs: number, leaseMs: number, limit: number) {
    const { data, error } = await this.db.rpc("klynge_claim_workflow_jobs", {
      p_worker: workerId, p_now: nowMs, p_lease_ms: leaseMs, p_limit: limit,
    });
    if (error) throw new Error("WORKFLOW_CLAIM_FAILED");
    if (!Array.isArray(data)) throw new Error("INVALID_CLAIM_RESPONSE");
    return data.map(jobFromRow);
  }
  async finish(tenantId: string, jobId: string, workerId: string, fencingToken: number, nowMs: number, succeeded: boolean) {
    const { data, error } = await this.db.rpc("klynge_finish_workflow_job", {
      p_tenant: tenantId, p_job: jobId, p_worker: workerId, p_token: fencingToken,
      p_now: nowMs, p_success: succeeded,
    });
    if (error) throw new Error("WORKFLOW_FINISH_FAILED");
    if (typeof data !== "boolean") throw new Error("INVALID_FINISH_RESPONSE");
    return data;
  }
}
