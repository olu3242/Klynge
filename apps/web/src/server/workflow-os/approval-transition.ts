import type { QueueRpc } from "./postgres-queue.ts";
/** Atomic decision + workflow transition. Reviewer identity MUST be verified independently. */
export class AtomicApprovalTransition {
  constructor(private readonly db: QueueRpc) {}
  async decide(input: {
    tenantId: string; approvalId: string; reviewerId: string;
    approvalRevision: number; workflowRevision: number;
    approve: boolean; nowMs: number; eventId: string;
  }): Promise<boolean> {
    if (!input.tenantId.trim() || !input.approvalId.trim() ||
      !input.reviewerId.trim() || !input.eventId.trim() ||
      !Number.isSafeInteger(input.approvalRevision) || input.approvalRevision < 0 ||
      !Number.isSafeInteger(input.workflowRevision) || input.workflowRevision < 0 ||
      !Number.isSafeInteger(input.nowMs) || input.nowMs < 0)
      throw new Error("INVALID_APPROVAL_TRANSITION");
    const { data, error } = await this.db.rpc("klynge_decide_workflow_approval", {
      p_tenant: input.tenantId, p_approval: input.approvalId,
      p_reviewer: input.reviewerId, p_expected_revision: input.approvalRevision,
      p_workflow_revision: input.workflowRevision, p_approve: input.approve,
      p_now: input.nowMs, p_event: input.eventId,
    });
    if (error) throw new Error("APPROVAL_TRANSITION_FAILED");
    if (typeof data !== "boolean") throw new Error("INVALID_APPROVAL_TRANSITION_RESPONSE");
    return data;
  }
}
