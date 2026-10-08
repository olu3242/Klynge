import { createHash } from "node:crypto";
import type { MemoryAccountStore } from "../account/memory-account-store.ts";
import type { OpsReport } from "../ops/ops-report.ts";
import { operatorRef } from "../ops/ops-report.ts";
import type { MemorySessionStore } from "../store/memory-store.ts";
import type { PilotAnalytics } from "./analytics.ts";
import type { MemoryPilotStore } from "./memory-pilot-store.ts";
import type { EnrollmentStatus, FeedbackEntry, FeedbackTriage, OpsAuditAction, OpsAuditEntry, PilotInvite, TriageStatus } from "./types.ts";

/**
 * Restricted pilot control plane (Batch 78). Every action requires a server-derived operator (the caller checks
 * isOperator), is written to the append-only operator audit (hashed operator ref, no PII) and is isolated from
 * deterministic decisions: nothing here reads or writes decision records, runtime decisions or engine policy.
 */
export const tenantRef = (tenantId: string) => `usr_${createHash("sha256").update(`klynge-tenant-ref|${tenantId}`).digest("hex").slice(0, 12)}`;

export class AdminActionError extends Error {
  override readonly name = "AdminActionError";
}

export interface AdminStores {
  pilot: MemoryPilotStore;
  account: MemoryAccountStore | null;
  durable: MemorySessionStore | null;
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[A-Za-z]{2,24}$/;
const STATUS_ACTION: Record<EnrollmentStatus, OpsAuditAction> = { ACTIVE: "pilot.reinstated", SUSPENDED: "pilot.suspended", COMPLETED: "pilot.completed" };
const TRIAGE: readonly TriageStatus[] = ["NEW", "ACKNOWLEDGED", "DEFECT_CONFIRMED", "NOT_A_DEFECT", "NEEDS_INFO"];

function log(s: AdminStores, operatorUserId: string, action: OpsAuditAction, detail: string, at: number): OpsAuditEntry {
  const operator = operatorRef(operatorUserId);
  const e = { auditId: `ops_${createHash("sha256").update(`${operator}|${action}|${at}|${detail}`).digest("hex").slice(0, 24)}`, at, operator, action, detail: detail.slice(0, 160) };
  s.pilot.appendOpsAudit(e);
  return e;
}

export type AdminAction =
  | { action: "invite"; email: string; cohort?: string }
  | { action: "revoke"; email: string }
  | { action: "set-status"; tenantRef: string; status: EnrollmentStatus; reason?: string }
  | { action: "triage"; tenantRef: string; feedbackId: string; status: TriageStatus; defectRef?: string | null }
  | { action: "requeue"; notificationId: string };

export async function adminAction(s: AdminStores, operatorUserId: string, a: AdminAction, now: number): Promise<{ ok: true; detail: string }> {
  const tenantOf = (ref: string) => {
    const ids = new Set([...s.pilot.allEnrollments().map((e) => e.tenantId), ...s.pilot.allFeedback().map((f) => f.tenantId)]);
    const t = [...ids].find((id) => tenantRef(id) === ref);
    if (!t) throw new AdminActionError("Unknown user reference");
    return t;
  };
  switch (a.action) {
    case "invite": {
      const email = String(a.email ?? "").trim().toLowerCase();
      if (!EMAIL.test(email)) throw new AdminActionError("Enter a valid email address");
      const cohort = /^[a-z0-9-]{1,32}$/.test(a.cohort ?? "") ? (a.cohort as string) : "pilot-1";
      s.pilot.invite(email, cohort, now);
      log(s, operatorUserId, "pilot.invited", `cohort ${cohort}`, now);
      return { ok: true, detail: "invited" };
    }
    case "revoke": {
      if (!s.pilot.revoke(String(a.email ?? ""), now)) throw new AdminActionError("No pending invitation for that address");
      log(s, operatorUserId, "pilot.revoked", "1 invitation", now);
      return { ok: true, detail: "revoked" };
    }
    case "set-status": {
      if (!["ACTIVE", "SUSPENDED", "COMPLETED"].includes(a.status)) throw new AdminActionError("Unknown status");
      const e = s.pilot.setStatus(tenantOf(a.tenantRef), a.status, typeof a.reason === "string" ? a.reason : null, now);
      if (!e) throw new AdminActionError("No enrollment for that user");
      log(s, operatorUserId, STATUS_ACTION[a.status], `1 enrollment → ${a.status}`, now);
      return { ok: true, detail: a.status };
    }
    case "triage": {
      if (!TRIAGE.includes(a.status)) throw new AdminActionError("Unknown triage status");
      const tenantId = tenantOf(a.tenantRef);
      if (!s.pilot.allFeedback().some((f) => f.tenantId === tenantId && f.feedbackId === a.feedbackId)) throw new AdminActionError("Unknown feedback");
      const defectRef = a.status === "DEFECT_CONFIRMED" ? (/^KLY-\d{1,6}$/.test(a.defectRef ?? "") ? (a.defectRef as string) : null) : null;
      if (a.status === "DEFECT_CONFIRMED" && !defectRef) throw new AdminActionError("A confirmed defect needs a defect register reference (KLY-n)");
      const t: FeedbackTriage = { tenantId, feedbackId: a.feedbackId, status: a.status, defectRef, reviewer: operatorRef(operatorUserId), at: now };
      s.pilot.setTriage(t);
      log(s, operatorUserId, "feedback.triaged", `→ ${a.status}${defectRef ? ` ${defectRef}` : ""}`, now);
      return { ok: true, detail: a.status };
    }
    case "requeue": {
      if (!s.account) throw new AdminActionError("No in-process outbox on this server");
      const item = s.account.allOutbox().find((o) => o.notificationId === a.notificationId && o.status === "FAILED");
      if (!item) throw new AdminActionError("No dead-lettered notification with that id");
      await s.account.updateOutbox({ ...item, status: "PENDING", attempts: 0, nextAttemptAt: now, lastError: "requeued by operator" });
      log(s, operatorUserId, "notification.requeued", "1 notification", now);
      return { ok: true, detail: "requeued" };
    }
    default:
      throw new AdminActionError("Unknown action");
  }
}

export interface AdminView {
  invites: PilotInvite[];
  enrollments: { tenantRef: string; status: EnrollmentStatus; cohort: string; activatedAt: number; statusChangedAt: number; statusReason: string | null }[];
  feedback: (Omit<FeedbackEntry, "tenantId"> & { tenantRef: string; triage: Omit<FeedbackTriage, "tenantId"> | null })[];
  deadLetters: { notificationId: string; event: string; symbol: string; attempts: number; lastError: string | null }[];
  incidents: OpsReport["incidents"];
  opsAudit: OpsAuditEntry[];
  analytics: PilotAnalytics;
}

/** Operator view. Feedback text is user-written support content (restricted page); no emails beyond invitations. */
export function adminView(s: AdminStores, ops: OpsReport, analytics: PilotAnalytics): AdminView {
  const triage = new Map(s.pilot.allTriage().map((t) => [`${t.tenantId}|${t.feedbackId}`, t]));
  return {
    invites: s.pilot.allInvites(),
    enrollments: s.pilot.allEnrollments().map((e) => ({ tenantRef: tenantRef(e.tenantId), status: e.status, cohort: e.cohort, activatedAt: e.activatedAt, statusChangedAt: e.statusChangedAt, statusReason: e.statusReason })),
    feedback: s.pilot.allFeedback().map(({ tenantId, ...f }) => {
      const t = triage.get(`${tenantId}|${f.feedbackId}`);
      return { ...f, tenantRef: tenantRef(tenantId), triage: t ? { feedbackId: t.feedbackId, status: t.status, defectRef: t.defectRef, reviewer: t.reviewer, at: t.at } : null };
    }),
    deadLetters: (s.account?.allOutbox() ?? []).filter((o) => o.status === "FAILED").map((o) => ({ notificationId: o.notificationId, event: o.event, symbol: o.symbol, attempts: o.attempts, lastError: o.lastError })),
    incidents: ops.incidents,
    opsAudit: s.pilot.allOpsAudit().slice(0, 100),
    analytics,
  };
}
