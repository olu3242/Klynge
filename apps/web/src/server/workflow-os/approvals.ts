export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";
export interface Approval {
  approvalId: string; tenantId: string; workflowId: string; action: string;
  requestedBy: string; status: ApprovalStatus; reviewerId: string | null;
  decidedAtMs: number | null; expiresAtMs: number; revision: number;
}
export type ApprovalDecision =
  | { kind: "APPLIED"; approval: Approval }
  | { kind: "REJECTED"; reason: string };
/** Only an independently authorized human reviewer may decide.
 * Callers must validate the reviewer identity and role before invoking this policy.
 */
export function decideApproval(
  prior: Approval,
  input: { tenantId: string; reviewerId: string; reviewerAuthorized: boolean;
    approve: boolean; expectedRevision: number; atMs: number },
): ApprovalDecision {
  if (prior.tenantId !== input.tenantId) return { kind: "REJECTED", reason: "TENANT_MISMATCH" };
  if (!input.reviewerAuthorized || !input.reviewerId.trim()) return { kind: "REJECTED", reason: "REVIEWER_NOT_AUTHORIZED" };
  if (prior.requestedBy === input.reviewerId) return { kind: "REJECTED", reason: "SELF_APPROVAL_FORBIDDEN" };
  if (prior.status !== "PENDING") return { kind: "REJECTED", reason: "ALREADY_DECIDED" };
  if (prior.revision !== input.expectedRevision) return { kind: "REJECTED", reason: "REVISION_CONFLICT" };
  if (!Number.isSafeInteger(input.atMs) || input.atMs >= prior.expiresAtMs) return { kind: "REJECTED", reason: "APPROVAL_EXPIRED" };
  return { kind: "APPLIED", approval: {
    ...prior, status: input.approve ? "APPROVED" : "REJECTED",
    reviewerId: input.reviewerId, decidedAtMs: input.atMs, revision: prior.revision + 1,
  } };
}
