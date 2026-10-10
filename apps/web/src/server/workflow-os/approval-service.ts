import { decideApproval, type Approval } from "./approvals.ts";

/** Trust boundary: caller MUST derive reviewer identity from a verified server session.
 * Never accept reviewer IDs, roles or authorization booleans from client payloads.
 */
export interface VerifiedReviewer {
  userId: string;
  tenantId: string;
  roles: readonly string[];
  verified: true;
}
export interface ReviewerAuthenticator {
  authenticate(): Promise<VerifiedReviewer | null>;
}
export interface ApprovalRepository {
  load(tenantId: string, approvalId: string): Promise<Approval | null>;
  decide(prior: Approval, next: Approval): Promise<boolean>;
}
export class ApprovalService {
  private readonly auth: ReviewerAuthenticator, private readonly store: ApprovalRepository;
  constructor(auth: ReviewerAuthenticator, private readonly store: ApprovalRepository) { this.auth = auth; }
  async decide(input: {
    tenantId: string; approvalId: string; approve: boolean;
    expectedRevision: number; atMs: number;
  }): Promise<{ kind: "APPLIED" } | { kind: "DENIED"; reason: string }> {
    const reviewer = await this.auth.authenticate();
    if (!reviewer || reviewer.verified !== true || !reviewer.userId.trim() ||
        reviewer.tenantId !== input.tenantId || !reviewer.roles.includes("workflow.approve"))
      return { kind: "DENIED", reason: "REVIEWER_UNAUTHORIZED" };
    const prior = await this.store.load(input.tenantId, input.approvalId);
    if (!prior) return { kind: "DENIED", reason: "NOT_FOUND" };
    const verdict = decideApproval(prior, {
      tenantId: reviewer.tenantId, reviewerId: reviewer.userId,
      reviewerAuthorized: true, approve: input.approve,
      expectedRevision: input.expectedRevision, atMs: input.atMs,
    });
    if (verdict.kind !== "APPLIED") return { kind: "DENIED", reason: verdict.reason };
    const saved = await this.store.decide(prior, verdict.approval);
    return saved ? { kind: "APPLIED" } : { kind: "DENIED", reason: "CONCURRENT_UPDATE" };
  }
}
