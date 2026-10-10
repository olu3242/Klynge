import type { QueueRpc } from "./postgres-queue.ts";
import type { Checkpoint } from "./checkpoints.ts";
import { validateCheckpoint } from "./checkpoints.ts";

/** Single database transaction for checkpoint, workflow status and job acknowledgement.
 * Only invoke from a trusted, authorized service-role worker.
 */
export class AtomicWorkflowCompletion {
  private readonly db: QueueRpc;
  constructor(db: QueueRpc) { this.db = db; }
  async complete(input: {
    tenantId: string; jobId: string; workerId: string; fencingToken: number;
    eventId: string; expectedRevision: number; checkpoint: Checkpoint; nowMs: number;
  }): Promise<boolean> {
    const { checkpoint: c } = input;
    if (!validateCheckpoint(c) || c.tenantId !== input.tenantId ||
      !input.jobId.trim() || !input.workerId.trim() || !input.eventId.trim() ||
      !Number.isSafeInteger(input.fencingToken) || input.fencingToken < 1 ||
      !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 ||
      c.revision !== input.expectedRevision + 1 ||
      !Number.isSafeInteger(input.nowMs) || input.nowMs < c.completedAtMs)
      throw new Error("INVALID_ATOMIC_COMPLETION");
    const { data, error } = await this.db.rpc("klynge_complete_workflow_step", {
      p_tenant: input.tenantId, p_job: input.jobId, p_worker: input.workerId,
      p_token: input.fencingToken, p_now: input.nowMs,
      p_event: input.eventId, p_expected_revision: input.expectedRevision,
      p_step: c.stepId, p_evidence: [...c.evidenceIds], p_output_hash: c.outputHash,
    });
    if (error) throw new Error("ATOMIC_COMPLETION_FAILED");
    if (typeof data !== "boolean") throw new Error("INVALID_ATOMIC_COMPLETION_RESPONSE");
    return data;
  }
}
