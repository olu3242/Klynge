import { ApprovalService } from "./approval-service.ts";
import type { ReviewerAuthenticator, ApprovalRepository } from "./approval-service.ts";

/** Transport-neutral handler. Wire only to a trusted server route and server-owned DB. */
export async function handleApprovalRequest(
  auth: ReviewerAuthenticator, store: ApprovalRepository,
  body: unknown, nowMs: number,
): Promise<{ status: number; body: { error?: string; status?: string } }> {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return { status: 400, body: { error: "INVALID_REQUEST" } };
  const b = body as Record<string, unknown>;
  if (typeof b.tenantId !== "string" || typeof b.approvalId !== "string" ||
      typeof b.approve !== "boolean" || typeof b.expectedRevision !== "number" ||
      !Number.isSafeInteger(b.expectedRevision) || b.expectedRevision < 0 ||
      !Number.isSafeInteger(nowMs))
    return { status: 400, body: { error: "INVALID_REQUEST" } };
  const result = await new ApprovalService(auth, store).decide({
    tenantId: b.tenantId, approvalId: b.approvalId, approve: b.approve,
    expectedRevision: b.expectedRevision, atMs: nowMs,
  });
  if (result.kind === "APPLIED") return { status: 200, body: { status: "APPLIED" } };
  return { status: 404, body: { error: "NOT_AVAILABLE" } };
}
