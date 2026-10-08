import type { ChartSession, StateAlert } from "../engine-core.ts";
import type { DecisionRecord, ImageRetention, ImageStore, JournalEntry, SessionStore } from "./types.ts";

export class MemorySessionStore implements SessionStore {
  private sessions = new Map<string, ChartSession>();
  private records = new Map<string, DecisionRecord>();
  private alerts = new Map<string, StateAlert & { tenantId: string }>();
  private journal = new Map<string, JournalEntry>();
  private k = (t: string, id: string) => `${t}\u0000${id}`;

  async getSession(tenantId: string, sessionId: string) {
    return this.sessions.get(this.k(tenantId, sessionId));
  }
  async putSession(session: ChartSession) {
    this.sessions.set(this.k(session.tenantId, session.sessionId), session);
  }
  async deleteSession(tenantId: string, sessionId: string) {
    this.sessions.delete(this.k(tenantId, sessionId));
  }
  async putRecord(r: DecisionRecord) {
    const key = this.k(r.tenantId, r.recordId);
    if (this.records.has(key)) return false;
    this.records.set(key, r);
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
    return true;
  }
  async listAlerts(tenantId: string) {
    return [...this.alerts.values()].filter((a) => a.tenantId === tenantId).map(({ tenantId: _t, ...a }) => a).sort((a, b) => b.at - a.at);
  }
  async addJournal(e: JournalEntry) {
    const key = this.k(e.tenantId, e.entryId);
    if (this.journal.has(key)) return false;
    this.journal.set(key, e);
    return true;
  }
  async listJournal(tenantId: string, recordId?: string) {
    return [...this.journal.values()].filter((e) => e.tenantId === tenantId && (!recordId || e.recordId === recordId)).sort((a, b) => a.createdAt - b.createdAt);
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
}
