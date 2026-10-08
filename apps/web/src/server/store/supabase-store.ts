import type { SupabaseClient } from "@supabase/supabase-js";
import type { RuntimeState, StateAlert } from "../engine-core.ts";
import type { DecisionRecord, JournalEntry, SessionStore, StoredSession } from "./types.ts";

/**
 * Supabase adapter bound to the SIGNED-IN USER's session (anon key + user JWT via @supabase/ssr), so every query
 * runs under RLS (`tenant_id = auth.uid()`). It is constructed only with a verified user's id; the service-role
 * key is never used for user CRUD. Images are never written here. Inserts are idempotent (ON CONFLICT DO NOTHING).
 */
export class SupabaseSessionStore implements SessionStore {
  readonly durability = "DURABLE" as const;
  private readonly db: SupabaseClient;
  private readonly userId: string;
  constructor(userBoundClient: SupabaseClient, verifiedUserId: string) {
    this.db = userBoundClient;
    this.userId = verifiedUserId;
  }

  private own(tenantId: string): string {
    // Defense in depth: RLS rejects foreign rows; we refuse before asking.
    if (tenantId !== this.userId) throw new Error("tenant mismatch: durable rows are owned by the verified user only");
    return tenantId;
  }
  private static check<T>(r: { data: T; error: { message: string } | null }): T {
    if (r.error) throw new Error(`supabase: ${r.error.message}`);
    return r.data;
  }

  async getSession(tenantId: string, sessionId: string) {
    const t = this.own(tenantId);
    const rows = SupabaseSessionStore.check(await this.db.from("klynge_sessions").select("payload").eq("tenant_id", t).eq("session_id", sessionId).limit(1));
    return (rows?.[0]?.payload as StoredSession | undefined) ?? undefined;
  }
  async putSession(session: StoredSession) {
    const t = this.own(session.tenantId);
    SupabaseSessionStore.check(
      await this.db.from("klynge_sessions").upsert({ tenant_id: t, session_id: session.sessionId, origin: session.origin ?? "DIRECT", payload: session, updated_at: new Date().toISOString() }),
    );
  }
  async deleteSession(tenantId: string, sessionId: string) {
    const t = this.own(tenantId);
    SupabaseSessionStore.check(await this.db.from("klynge_sessions").delete().eq("tenant_id", t).eq("session_id", sessionId));
  }
  async putRecord(r: DecisionRecord) {
    const t = this.own(r.tenantId);
    const res = SupabaseSessionStore.check(
      await this.db
        .from("klynge_decisions")
        .upsert(
          { tenant_id: t, record_id: r.recordId, session_id: r.sessionId, symbol: r.symbol, timeframe: r.timeframe, evidence_mode: r.evidenceMode, origin: r.origin ?? "DIRECT", at: r.at, payload: r },
          { onConflict: "tenant_id,record_id", ignoreDuplicates: true },
        )
        .select("record_id"),
    );
    return (res?.length ?? 0) > 0;
  }
  async listRecords(tenantId: string, filter: { symbol?: string; sessionId?: string } = {}) {
    const t = this.own(tenantId);
    let q = this.db.from("klynge_decisions").select("payload").eq("tenant_id", t);
    if (filter.symbol) q = q.eq("symbol", filter.symbol);
    if (filter.sessionId) q = q.eq("session_id", filter.sessionId);
    const rows = SupabaseSessionStore.check(await q.order("at", { ascending: true }).order("record_id", { ascending: true }));
    return (rows ?? []).map((x) => x.payload as DecisionRecord);
  }
  async addAlert(tenantId: string, a: StateAlert) {
    const t = this.own(tenantId);
    const res = SupabaseSessionStore.check(
      await this.db.from("klynge_alerts").upsert({ tenant_id: t, alert_id: a.alertId, at: a.at, payload: a }, { onConflict: "tenant_id,alert_id", ignoreDuplicates: true }).select("alert_id"),
    );
    return (res?.length ?? 0) > 0;
  }
  async listAlerts(tenantId: string) {
    const t = this.own(tenantId);
    const rows = SupabaseSessionStore.check(await this.db.from("klynge_alerts").select("payload").eq("tenant_id", t).order("at", { ascending: false }));
    return (rows ?? []).map((x) => x.payload as StateAlert);
  }
  async addJournal(e: JournalEntry) {
    const t = this.own(e.tenantId);
    const res = SupabaseSessionStore.check(
      await this.db
        .from("klynge_journal")
        .upsert({ tenant_id: t, entry_id: e.entryId, record_id: e.recordId, symbol: e.symbol, note: e.note, author: e.author, created_at: e.createdAt }, { onConflict: "tenant_id,entry_id", ignoreDuplicates: true })
        .select("entry_id"),
    );
    return (res?.length ?? 0) > 0;
  }
  async listJournal(tenantId: string, recordId?: string) {
    const t = this.own(tenantId);
    let q = this.db.from("klynge_journal").select("*").eq("tenant_id", t);
    if (recordId) q = q.eq("record_id", recordId);
    const rows = SupabaseSessionStore.check(await q.order("created_at", { ascending: true }));
    return (rows ?? []).map((x) => ({ entryId: x.entry_id, tenantId: x.tenant_id, recordId: x.record_id, symbol: x.symbol, note: x.note, author: x.author, createdAt: x.created_at }) as JournalEntry);
  }
  async getRuntimeState(tenantId: string, runtimeId: string) {
    const t = this.own(tenantId);
    const rows = SupabaseSessionStore.check(await this.db.from("klynge_runtime_state").select("payload").eq("tenant_id", t).eq("runtime_id", runtimeId).limit(1));
    return (rows?.[0]?.payload as RuntimeState | undefined) ?? null;
  }
  async putRuntimeState(tenantId: string, state: RuntimeState) {
    const t = this.own(tenantId);
    SupabaseSessionStore.check(
      await this.db.from("klynge_runtime_state").upsert({ tenant_id: t, runtime_id: state.runtimeId, last_market_timestamp: state.lastMarketTimestamp, payload: state, updated_at: new Date().toISOString() }),
    );
  }
}
