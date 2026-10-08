import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChartSession, StateAlert } from "../engine-core.ts";
import type { DecisionRecord, JournalEntry, SessionStore } from "./types.ts";

/**
 * Supabase adapter (server-only; SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY). Tables and tenant-scoped RLS are in
 * supabase/migrations. Images are NEVER written here. Inserts use ON CONFLICT DO NOTHING for idempotency.
 */
export class SupabaseSessionStore implements SessionStore {
  private readonly db: SupabaseClient;
  constructor(db: SupabaseClient) {
    this.db = db;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): SupabaseSessionStore {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
    return new SupabaseSessionStore(createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }));
  }

  private static check<T>(r: { data: T; error: { message: string } | null }): T {
    if (r.error) throw new Error(`supabase: ${r.error.message}`);
    return r.data;
  }

  async getSession(tenantId: string, sessionId: string) {
    const rows = SupabaseSessionStore.check(await this.db.from("klynge_sessions").select("payload").eq("tenant_id", tenantId).eq("session_id", sessionId).limit(1));
    return (rows?.[0]?.payload as ChartSession | undefined) ?? undefined;
  }
  async putSession(session: ChartSession) {
    SupabaseSessionStore.check(await this.db.from("klynge_sessions").upsert({ tenant_id: session.tenantId, session_id: session.sessionId, payload: session }));
  }
  async deleteSession(tenantId: string, sessionId: string) {
    SupabaseSessionStore.check(await this.db.from("klynge_sessions").delete().eq("tenant_id", tenantId).eq("session_id", sessionId));
  }
  async putRecord(r: DecisionRecord) {
    const res = SupabaseSessionStore.check(
      await this.db
        .from("klynge_decisions")
        .upsert(
          { tenant_id: r.tenantId, record_id: r.recordId, session_id: r.sessionId, symbol: r.symbol, timeframe: r.timeframe, evidence_mode: r.evidenceMode, at: r.at, payload: r },
          { onConflict: "tenant_id,record_id", ignoreDuplicates: true },
        )
        .select("record_id"),
    );
    return (res?.length ?? 0) > 0;
  }
  async listRecords(tenantId: string, filter: { symbol?: string; sessionId?: string } = {}) {
    let q = this.db.from("klynge_decisions").select("payload").eq("tenant_id", tenantId);
    if (filter.symbol) q = q.eq("symbol", filter.symbol);
    if (filter.sessionId) q = q.eq("session_id", filter.sessionId);
    const rows = SupabaseSessionStore.check(await q.order("at", { ascending: true }).order("record_id", { ascending: true }));
    return (rows ?? []).map((x) => x.payload as DecisionRecord);
  }
  async addAlert(tenantId: string, a: StateAlert) {
    const res = SupabaseSessionStore.check(
      await this.db.from("klynge_alerts").upsert({ tenant_id: tenantId, alert_id: a.alertId, at: a.at, payload: a }, { onConflict: "tenant_id,alert_id", ignoreDuplicates: true }).select("alert_id"),
    );
    return (res?.length ?? 0) > 0;
  }
  async listAlerts(tenantId: string) {
    const rows = SupabaseSessionStore.check(await this.db.from("klynge_alerts").select("payload").eq("tenant_id", tenantId).order("at", { ascending: false }));
    return (rows ?? []).map((x) => x.payload as StateAlert);
  }
  async addJournal(e: JournalEntry) {
    const res = SupabaseSessionStore.check(
      await this.db
        .from("klynge_journal")
        .upsert({ tenant_id: e.tenantId, entry_id: e.entryId, record_id: e.recordId, symbol: e.symbol, note: e.note, author: e.author, created_at: e.createdAt }, { onConflict: "tenant_id,entry_id", ignoreDuplicates: true })
        .select("entry_id"),
    );
    return (res?.length ?? 0) > 0;
  }
  async listJournal(tenantId: string, recordId?: string) {
    let q = this.db.from("klynge_journal").select("*").eq("tenant_id", tenantId);
    if (recordId) q = q.eq("record_id", recordId);
    const rows = SupabaseSessionStore.check(await q.order("created_at", { ascending: true }));
    return (rows ?? []).map((x) => ({ entryId: x.entry_id, tenantId: x.tenant_id, recordId: x.record_id, symbol: x.symbol, note: x.note, author: x.author, createdAt: x.created_at }) as JournalEntry);
  }
}
