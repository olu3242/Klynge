import type { SupabaseClient } from "@supabase/supabase-js";
import type { FeedbackEntry, OnboardingProgress, PilotEnrollment, PilotInvite, PilotStore } from "./types.ts";

/** User-bound (RLS) pilot store: same client + verified user id as the session store. */
export class SupabasePilotStore implements PilotStore {
  private readonly db: SupabaseClient;
  private readonly userId: string;
  constructor(userBoundClient: SupabaseClient, verifiedUserId: string) {
    this.db = userBoundClient;
    this.userId = verifiedUserId;
  }
  private own(t: string) {
    if (t !== this.userId) throw new Error("tenant mismatch: pilot rows are owned by the verified user only");
    return t;
  }
  private static check<T>(r: { data: T; error: { message: string; code?: string } | null }, tolerate?: string): T {
    if (r.error && r.error.code !== tolerate) throw new Error(`supabase: ${r.error.message}`);
    return r.data;
  }
  async getInvite(email: string) {
    const rows = SupabasePilotStore.check(await this.db.from("klynge_pilot_invites").select("email_lower, cohort, invited_at, revoked_at").eq("email_lower", email.toLowerCase()).limit(1));
    const r = rows?.[0];
    return r ? { email: r.email_lower as string, cohort: r.cohort as string, invitedAt: Number(r.invited_at), revokedAt: r.revoked_at === null ? null : Number(r.revoked_at) } satisfies PilotInvite : null;
  }
  async getEnrollment(tenantId: string) {
    const t = this.own(tenantId);
    const rows = SupabasePilotStore.check(await this.db.from("klynge_pilot_enrollment").select("*").eq("tenant_id", t).limit(1));
    const r = rows?.[0];
    return r
      ? ({ tenantId: t, status: r.status, cohort: r.cohort, activatedAt: Number(r.activated_at), riskAckVersion: r.risk_ack_version, consentVersion: r.consent_version, statusChangedAt: Number(r.status_changed_at), statusReason: r.status_reason ?? null } satisfies PilotEnrollment)
      : null;
  }
  async activate(e: PilotEnrollment) {
    const t = this.own(e.tenantId);
    const res = await this.db.from("klynge_pilot_enrollment").insert({ tenant_id: t, status: "ACTIVE", cohort: e.cohort, activated_at: e.activatedAt, risk_ack_version: e.riskAckVersion, consent_version: e.consentVersion, status_changed_at: e.statusChangedAt });
    if (res.error?.code === "23505") return false;
    SupabasePilotStore.check(res);
    return true;
  }
  async getOnboarding(tenantId: string) {
    const t = this.own(tenantId);
    const rows = SupabasePilotStore.check(await this.db.from("klynge_onboarding").select("payload").eq("tenant_id", t).limit(1));
    return (rows?.[0]?.payload as OnboardingProgress | undefined) ?? null;
  }
  async putOnboarding(tenantId: string, p: OnboardingProgress) {
    const t = this.own(tenantId);
    SupabasePilotStore.check(await this.db.from("klynge_onboarding").upsert({ tenant_id: t, payload: p, updated_at: new Date().toISOString() }));
  }
  async addFeedback(f: FeedbackEntry) {
    const t = this.own(f.tenantId);
    const res = await this.db.from("klynge_feedback").insert({ tenant_id: t, feedback_id: f.feedbackId, session_id: f.sessionId, record_id: f.recordId, at: f.at, payload: f });
    if (res.error?.code === "23505") return false;
    SupabasePilotStore.check(res);
    return true;
  }
  async listFeedback(tenantId: string) {
    const t = this.own(tenantId);
    const rows = SupabasePilotStore.check(await this.db.from("klynge_feedback").select("payload").eq("tenant_id", t).order("at", { ascending: true }));
    return (rows ?? []).map((r) => r.payload as FeedbackEntry);
  }
}
