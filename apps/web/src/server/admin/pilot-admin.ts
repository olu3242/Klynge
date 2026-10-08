import "server-only";
import { createHash } from "node:crypto";
import { operatorRef } from "../ops/ops-report.ts";
import type { EnrollmentStatus, OpsAuditAction, TriageStatus } from "../pilot/types.ts";
import { serviceRoleClient } from "./service-role.ts";

/**
 * Hosted pilot administration (Batch 78) — run by an operator from `scripts/pilot-admin.ts`, never on a request path.
 * Uses ONLY the allow-listed "pilot.admin" service-role operation. Touches pilot tables and the operator audit only.
 */
export function hostedPilotAdmin(operatorName: string, env: Readonly<Record<string, string | undefined>> = process.env) {
  const db = serviceRoleClient("pilot.admin", env);
  const operator = operatorRef(operatorName);
  const check = (r: { error: { message: string } | null }) => {
    if (r.error) throw new Error(`pilot admin: ${r.error.message}`);
  };
  const log = async (action: OpsAuditAction, detail: string, at: number) =>
    check(await db.from("klynge_ops_audit").insert({ audit_id: `ops_${createHash("sha256").update(`${operator}|${action}|${at}|${detail}`).digest("hex").slice(0, 24)}`, at, operator, action, detail: detail.slice(0, 160) }));
  return {
    async invite(email: string, cohort: string, at: number) {
      check(await db.from("klynge_pilot_invites").upsert({ email_lower: email.trim().toLowerCase(), cohort, invited_at: at, revoked_at: null }));
      await log("pilot.invited", `cohort ${cohort}`, at);
    },
    async revoke(email: string, at: number) {
      check(await db.from("klynge_pilot_invites").update({ revoked_at: at }).eq("email_lower", email.trim().toLowerCase()).is("revoked_at", null));
      await log("pilot.revoked", "1 invitation", at);
    },
    async setStatus(userId: string, status: EnrollmentStatus, reason: string | null, at: number) {
      check(await db.from("klynge_pilot_enrollment").update({ status, status_reason: reason?.slice(0, 160) ?? null, status_changed_at: at }).eq("tenant_id", userId));
      await log(status === "ACTIVE" ? "pilot.reinstated" : status === "SUSPENDED" ? "pilot.suspended" : "pilot.completed", `1 enrollment → ${status}`, at);
    },
    async triage(userId: string, feedbackId: string, status: TriageStatus, defectRef: string | null, at: number) {
      if (status === "DEFECT_CONFIRMED" && !/^KLY-\d{1,6}$/.test(defectRef ?? "")) throw new Error("a confirmed defect needs a KLY-n reference");
      check(await db.from("klynge_feedback_triage").upsert({ tenant_id: userId, feedback_id: feedbackId, status, defect_ref: status === "DEFECT_CONFIRMED" ? defectRef : null, reviewer: operator, at }));
      await log("feedback.triaged", `→ ${status}`, at);
    },
    async summary() {
      const count = async (t: string, f?: [string, string]) => {
        let q = db.from(t).select("*", { count: "exact", head: true });
        if (f) q = q.eq(f[0], f[1]);
        const r = await q;
        check(r);
        return r.count ?? 0;
      };
      return { invites: await count("klynge_pilot_invites"), active: await count("klynge_pilot_enrollment", ["status", "ACTIVE"]), suspended: await count("klynge_pilot_enrollment", ["status", "SUSPENDED"]), completed: await count("klynge_pilot_enrollment", ["status", "COMPLETED"]), feedback: await count("klynge_feedback") };
    },
  };
}
