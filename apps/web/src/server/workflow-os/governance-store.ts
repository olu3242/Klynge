import type { Approval } from "./approvals.ts";
import type { Checkpoint } from "./checkpoints.ts";
import { validateCheckpoint } from "./checkpoints.ts";
import type { SqlExecutor } from "./postgres-store.ts";

/** Only call after verifying the authenticated reviewer's role server-side. */
export class PostgresWorkflowGovernanceStore {
  constructor(private readonly db: SqlExecutor) {}
  async load(tenantId: string, approvalId: string): Promise<Approval | null> {
    const r = await this.db.query<Record<string, unknown>>(
      "select tenant_id, approval_id, workflow_id, action, requested_by, status, reviewer_id, decided_at_ms, expires_at_ms, revision from public.klynge_workflow_approvals where tenant_id=$1 and approval_id=$2",
      [tenantId, approvalId],
    );
    const row = r.rows[0];
    if (!row) return null;
    if (row.status !== "PENDING" && row.status !== "APPROVED" && row.status !== "REJECTED") throw new Error("INVALID_APPROVAL_STATUS");
    return { tenantId: String(row.tenant_id), approvalId: String(row.approval_id),
      workflowId: String(row.workflow_id), action: String(row.action),
      requestedBy: String(row.requested_by), status: row.status,
      reviewerId: row.reviewer_id === null ? null : String(row.reviewer_id),
      decidedAtMs: row.decided_at_ms === null ? null : Number(row.decided_at_ms),
      expiresAtMs: Number(row.expires_at_ms), revision: Number(row.revision) };
  }
  async decide(prior: Approval, next: Approval): Promise<boolean> {
    if (prior.tenantId !== next.tenantId || prior.approvalId !== next.approvalId ||
      prior.workflowId !== next.workflowId || prior.status !== "PENDING" ||
      next.status === "PENDING" || next.revision !== prior.revision + 1 ||
      !next.reviewerId || next.reviewerId === prior.requestedBy ||
      next.decidedAtMs === null || next.decidedAtMs >= prior.expiresAtMs) return false;
    const r = await this.db.query<Record<string, unknown>>(
      `update public.klynge_workflow_approvals set status=$5, reviewer_id=$6,
       decided_at_ms=$7, revision=$8
       where tenant_id=$1 and approval_id=$2 and workflow_id=$3 and revision=$4
       and status='PENDING' and requested_by <> $6 and expires_at_ms > $7
       returning approval_id`,
      [prior.tenantId, prior.approvalId, prior.workflowId, prior.revision,
       next.status, next.reviewerId, next.decidedAtMs, next.revision],
    );
    return r.rows.length === 1;
  }
  async saveCheckpoint(c: Checkpoint): Promise<boolean> {
    if (!validateCheckpoint(c)) return false;
    const r = await this.db.query<Record<string, unknown>>(
      `insert into public.klynge_workflow_checkpoints
       (tenant_id, workflow_id, step_id, revision, evidence_ids, output_hash, completed_at_ms)
       values ($1,$2,$3,$4,$5::jsonb,$6,$7)
       on conflict (tenant_id,workflow_id,step_id) do nothing returning step_id`,
      [c.tenantId, c.workflowId, c.stepId, c.revision,
       JSON.stringify(c.evidenceIds), c.outputHash, c.completedAtMs],
    );
    return r.rows.length === 1;
  }
}
