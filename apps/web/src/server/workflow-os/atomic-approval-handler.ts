import type { ReviewerAuthenticator } from "./approval-service.ts";
import type { Approval } from "./approvals.ts";
import { decideApproval } from "./approvals.ts";
import { AtomicApprovalTransition } from "./approval-transition.ts";
import type { QueueRpc } from "./postgres-queue.ts";

export interface AtomicApprovalLookup {
  load(tenantId: string, approvalId: string): Promise<Approval | null>;
  workflowRevision(tenantId: string, workflowId: string): Promise<number | null>;
}
/** One atomic DB transition after verified identity and independent-review policy. */
export async function handleAtomicApproval(
  auth: ReviewerAuthenticator, lookup: AtomicApprovalLookup, rpc: QueueRpc,
  body: unknown, nowMs: number,
): Promise<{ status: number; body: { status?: string; error?: string } }> {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return { status: 400, body: { error: "INVALID_REQUEST" } };
  const b = body as Record<string, unknown>;
  if (typeof b.tenantId !== "string" || !b.tenantId.trim() ||
      typeof b.approvalId !== "string" || !b.approvalId.trim() ||
      typeof b.approve !== "boolean" || typeof b.expectedRevision !== "number" ||
      !Number.isSafeInteger(b.expectedRevision) || b.expectedRevision < 0 ||
      !Number.isSafeInteger(nowMs) || nowMs < 0)
    return { status: 400, body: { error: "INVALID_REQUEST" } };
  const reviewer = await auth.authenticate();
  if (!reviewer || reviewer.verified !== true || !reviewer.userId.trim() ||
      reviewer.tenantId !== b.tenantId || !reviewer.roles.includes("workflow.approve"))
    return { status: 404, body: { error: "NOT_AVAILABLE" } };
  const prior = await lookup.load(b.tenantId, b.approvalId);
  if (!prior) return { status: 404, body: { error: "NOT_AVAILABLE" } };
  const policy = decideApproval(prior, {
    tenantId: reviewer.tenantId, reviewerId: reviewer.userId, reviewerAuthorized: true,
    approve: b.approve, expectedRevision: b.expectedRevision, atMs: nowMs,
  });
  if (policy.kind !== "APPLIED") return { status: 404, body: { error: "NOT_AVAILABLE" } };
  const revision = await lookup.workflowRevision(prior.tenantId, prior.workflowId);
  if (revision === null || !Number.isSafeInteger(revision) || revision < 0)
    return { status: 404, body: { error: "NOT_AVAILABLE" } };
  // Deterministic per-decision event ID; duplicate requests cannot create new events.
  const eventId = `approval:${prior.approvalId}:${prior.revision + 1}`;
  const applied = await new AtomicApprovalTransition(rpc).decide({
    tenantId: reviewer.tenantId, approvalId: prior.approvalId, reviewerId: reviewer.userId,
    approvalRevision: prior.revision, workflowRevision: revision,
    approve: b.approve, nowMs, eventId,
  });
  return applied ? { status: 200, body: { status: "APPLIED" } }
    : { status: 404, body: { error: "NOT_AVAILABLE" } };
}
