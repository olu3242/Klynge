import type { AuthGateway } from "../auth/types.ts";
import type { ReviewerAuthenticator, VerifiedReviewer } from "./approval-service.ts";

/** Auth.getUser() must verify JWT with Supabase Auth, not decode browser claims.
 * App role is from server-controlled app_metadata, never user_metadata.
 * Approvals are tenant-scoped and never authorize brokerage execution.
 */
export class SupabaseReviewerAuthenticator implements ReviewerAuthenticator {
  private readonly gateway: AuthGateway;
  constructor(gateway: AuthGateway) { this.gateway = gateway; }
  async authenticate(): Promise<VerifiedReviewer | null> {
    if (this.gateway.kind !== "supabase") return null;
    const user = await this.gateway.getUser();
    if (!user || !user.id.trim()) return null;
    const roles = user.appRole === "workflow_approver" || user.appRole === "operator"
      ? ["workflow.approve"] : [];
    return { userId: user.id, tenantId: user.id, roles, verified: true };
  }
}
