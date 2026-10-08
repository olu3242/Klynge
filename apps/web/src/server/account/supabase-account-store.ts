import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserRiskPolicy } from "../engine-core.ts";
import type { AccountStore, AuditEntry, NotificationPreferences, OutboxItem, PolicyVerdictRecord } from "./types.ts";

/** User-bound (RLS) account store: same client + verified user id as SupabaseSessionStore. */
export class SupabaseAccountStore implements AccountStore {
  private readonly db: SupabaseClient;
  private readonly userId: string;
  constructor(userBoundClient: SupabaseClient, verifiedUserId: string) {
    this.db = userBoundClient;
    this.userId = verifiedUserId;
  }
  private own(t: string) {
    if (t !== this.userId) throw new Error("tenant mismatch: account rows are owned by the verified user only");
    return t;
  }
  private static check<T>(r: { data: T; error: { message: string } | null }): T {
    if (r.error) throw new Error(`supabase: ${r.error.message}`);
    return r.data;
  }
  async getPolicy(tenantId: string) {
    const t = this.own(tenantId);
    const rows = SupabaseAccountStore.check(await this.db.from("klynge_user_policies").select("payload").eq("tenant_id", t).limit(1));
    return (rows?.[0]?.payload as UserRiskPolicy | undefined) ?? null;
  }
  async putPolicy(tenantId: string, policy: UserRiskPolicy) {
    const t = this.own(tenantId);
    SupabaseAccountStore.check(await this.db.from("klynge_user_policies").upsert({ tenant_id: t, payload: policy, updated_at: new Date().toISOString() }));
  }
  async putVerdict(v: PolicyVerdictRecord) {
    const t = this.own(v.tenantId);
    const res = SupabaseAccountStore.check(await this.db.from("klynge_policy_verdicts").upsert({ tenant_id: t, record_id: v.recordId, at: v.at, payload: v }, { onConflict: "tenant_id,record_id", ignoreDuplicates: true }).select("record_id"));
    return (res?.length ?? 0) > 0;
  }
  async listVerdicts(tenantId: string) {
    const t = this.own(tenantId);
    const rows = SupabaseAccountStore.check(await this.db.from("klynge_policy_verdicts").select("payload").eq("tenant_id", t).order("at", { ascending: true }));
    return (rows ?? []).map((r) => r.payload as PolicyVerdictRecord);
  }
  async getNotificationPrefs(tenantId: string) {
    const t = this.own(tenantId);
    const rows = SupabaseAccountStore.check(await this.db.from("klynge_notification_prefs").select("payload").eq("tenant_id", t).limit(1));
    return (rows?.[0]?.payload as NotificationPreferences | undefined) ?? null;
  }
  async putNotificationPrefs(tenantId: string, prefs: NotificationPreferences) {
    const t = this.own(tenantId);
    SupabaseAccountStore.check(await this.db.from("klynge_notification_prefs").upsert({ tenant_id: t, payload: prefs, updated_at: new Date().toISOString() }));
  }
  async enqueue(i: OutboxItem) {
    const t = this.own(i.tenantId);
    const res = SupabaseAccountStore.check(await this.db.from("klynge_notification_outbox").upsert({ tenant_id: t, notification_id: i.notificationId, status: i.status, next_attempt_at: i.nextAttemptAt, payload: i }, { onConflict: "tenant_id,notification_id", ignoreDuplicates: true }).select("notification_id"));
    return (res?.length ?? 0) > 0;
  }
  async updateOutbox(i: OutboxItem) {
    const t = this.own(i.tenantId);
    SupabaseAccountStore.check(await this.db.from("klynge_notification_outbox").update({ status: i.status, next_attempt_at: i.nextAttemptAt, payload: i }).eq("tenant_id", t).eq("notification_id", i.notificationId));
  }
  async listOutbox(tenantId: string) {
    const t = this.own(tenantId);
    const rows = SupabaseAccountStore.check(await this.db.from("klynge_notification_outbox").select("payload").eq("tenant_id", t).order("next_attempt_at", { ascending: true }));
    return (rows ?? []).map((r) => r.payload as OutboxItem);
  }
  async appendAudit(e: AuditEntry) {
    const t = this.own(e.tenantId);
    const res = SupabaseAccountStore.check(await this.db.from("klynge_audit_log").upsert({ tenant_id: t, audit_id: e.auditId, at: e.at, action: e.action, detail: e.detail }, { onConflict: "tenant_id,audit_id", ignoreDuplicates: true }).select("audit_id"));
    return (res?.length ?? 0) > 0;
  }
  async listAudit(tenantId: string, limit = 100) {
    const t = this.own(tenantId);
    const rows = SupabaseAccountStore.check(await this.db.from("klynge_audit_log").select("*").eq("tenant_id", t).order("at", { ascending: false }).limit(limit));
    return (rows ?? []).map((r) => ({ auditId: r.audit_id, tenantId: r.tenant_id, at: r.at, action: r.action, detail: r.detail }) as AuditEntry);
  }
}
