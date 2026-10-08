import type { RuntimeState, StateAlert } from "../engine-core.ts";
import type { DecisionRecord, ImageRetention, ImageStore, JournalEntry, SessionStore, StoredSession } from "./types.ts";

/** Durable in-process store (tests, local dev). Every read and write is scoped by the server-derived tenant id. */
export class MemorySessionStore implements SessionStore {
  readonly durability: "DURABLE" | "TRIAL" = "DURABLE";
  protected sessions = new Map<string, StoredSession>();
  protected records = new Map<string, DecisionRecord>();
  protected alerts = new Map<string, StateAlert & { tenantId: string }>();
  protected journal = new Map<string, JournalEntry>();
  protected runtime = new Map<string, RuntimeState & { tenantId: string }>();
  protected k = (t: string, id: string) => `${t}\u0000${id}`;
  /** Called after every mutation (FileSessionStore persists here). */
  protected changed(): void {}

  async getSession(tenantId: string, sessionId: string) {
    return this.sessions.get(this.k(tenantId, sessionId));
  }
  async putSession(session: StoredSession) {
    this.sessions.set(this.k(session.tenantId, session.sessionId), session);
    this.changed();
  }
  async deleteSession(tenantId: string, sessionId: string) {
    this.sessions.delete(this.k(tenantId, sessionId));
    this.changed();
  }
  async putRecord(r: DecisionRecord) {
    const key = this.k(r.tenantId, r.recordId);
    if (this.records.has(key)) return false;
    this.records.set(key, r);
    this.changed();
    return true;
  }
  async listRecords(tenantId: string, filter: { symbol?: string; sessionId?: string } = {}) {
    return [...this.records.values()]
      .filter((r) => r.tenantId === tenantId && (!filter.symbol || r.symbol === filter.symbol) && (!filter.sessionId || r.sessionId === filter.sessionId))
      .sort((a, b) => a.at - b.at || (a.recordId < b.recordId ? -1 : 1));
  }
  async addAlert(tenantId: string, alert: StateAlert) {
    const key = this.k(tenantId, alert.alertId);
    if (this.alerts.has(key)) return false;
    this.alerts.set(key, { ...alert, tenantId });
    this.changed();
    return true;
  }
  async listAlerts(tenantId: string) {
    return [...this.alerts.values()].filter((a) => a.tenantId === tenantId).map(({ tenantId: _t, ...a }) => a).sort((a, b) => b.at - a.at);
  }
  async addJournal(e: JournalEntry) {
    const key = this.k(e.tenantId, e.entryId);
    if (this.journal.has(key)) return false;
    this.journal.set(key, e);
    this.changed();
    return true;
  }
  async listJournal(tenantId: string, recordId?: string) {
    return [...this.journal.values()].filter((e) => e.tenantId === tenantId && (!recordId || e.recordId === recordId)).sort((a, b) => a.createdAt - b.createdAt);
  }
  async getRuntimeState(tenantId: string, runtimeId: string) {
    const s = this.runtime.get(this.k(tenantId, runtimeId));
    if (!s) return null;
    const { tenantId: _t, ...state } = s;
    return state;
  }
  async putRuntimeState(tenantId: string, state: RuntimeState) {
    this.runtime.set(this.k(tenantId, state.runtimeId), { ...state, tenantId });
    this.changed();
  }
  /** Infrastructure view for operator monitoring (in-process stores only). Never served to users. */
  infrastructureSnapshot(): { records: DecisionRecord[]; runtime: (RuntimeState & { tenantId: string })[]; alerts: (StateAlert & { tenantId: string })[]; sessions: StoredSession[]; journal: JournalEntry[] } {
    return { records: [...this.records.values()], runtime: [...this.runtime.values()], alerts: [...this.alerts.values()], sessions: [...this.sessions.values()], journal: [...this.journal.values()] };
  }
  /** Account deletion (in-process stores): remove every row owned by the tenant. */
  purgeTenant(tenantId: string): number {
    let n = 0;
    for (const m of [this.sessions, this.records, this.alerts, this.journal, this.runtime] as Map<string, { tenantId: string }>[]) {
      for (const [k, v] of m) if (v.tenantId === tenantId && m.delete(k)) n++;
    }
    if (n) this.changed();
    return n;
  }
  /** Deterministic recovery: drop a corrupted runtime cursor (the next verified evaluation rebuilds it idempotently). */
  quarantineRuntimeState(tenantId: string, runtimeId: string): boolean {
    const ok = this.runtime.delete(this.k(tenantId, runtimeId));
    if (ok) this.changed();
    return ok;
  }
}

/** In-memory image cache honoring the retention policy (NONE = never kept; SESSION = until session purge). */
export class MemoryImageStore implements ImageStore {
  private images = new Map<string, Buffer>();
  readonly retention: ImageRetention;
  constructor(retention: ImageRetention = "SESSION") {
    this.retention = retention;
  }
  private k = (t: string, s: string, c: string) => `${t}\u0000${s}\u0000${c}`;
  put(t: string, s: string, c: string, bytes: Buffer) {
    if (this.retention === "SESSION") this.images.set(this.k(t, s, c), bytes);
  }
  has(t: string, s: string, c: string) {
    return this.images.has(this.k(t, s, c));
  }
  purgeSession(t: string, s: string) {
    const prefix = `${t}\u0000${s}\u0000`;
    for (const key of [...this.images.keys()]) if (key.startsWith(prefix)) this.images.delete(key);
  }
  /** Account deletion: drop every processed image held for the tenant. */
  purgeTenant(t: string): number {
    let n = 0;
    for (const key of [...this.images.keys()]) if (key.startsWith(`${t}\u0000`) && this.images.delete(key)) n++;
    return n;
  }
}
