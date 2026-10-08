import type { RuntimeState, StateAlert } from "../engine-core.ts";
import type { DecisionRecord, JournalEntry, SessionStore, StoredSession } from "./types.ts";

export const TRIAL_TTL_MS = 2 * 60 * 60_000;
export const TRIAL_MAX_SESSIONS = 5_000;

/**
 * Anonymous trial storage: in-memory, session-scoped, short TTL, bounded. It keeps only what a visual trial needs
 * (charts + the visual context being shown). It refuses journal entries, alerts and runtime state, and nothing in it
 * is ever user-owned — promotion COPIES a snapshot into a verified user's durable store on explicit acceptance.
 */
export class TrialSessionStore implements SessionStore {
  readonly durability = "TRIAL" as const;
  private readonly sessions = new Map<string, { session: StoredSession; touched: number }>();
  private readonly records = new Map<string, DecisionRecord>();
  private readonly ttlMs: number;
  private readonly max: number;
  private readonly clock: () => number;
  constructor(opts: { ttlMs?: number; maxSessions?: number; clock?: () => number } = {}) {
    this.ttlMs = opts.ttlMs ?? TRIAL_TTL_MS;
    this.max = opts.maxSessions ?? TRIAL_MAX_SESSIONS;
    this.clock = opts.clock ?? (() => Date.now());
  }
  private k = (t: string, id: string) => `${t}\u0000${id}`;
  private assertTrial(tenantId: string) {
    if (!tenantId.startsWith("trial:")) throw new Error("trial store only holds anonymous trial sessions");
  }
  /** Drop expired trials (and their records); evict the oldest beyond the cap. */
  sweep(): number {
    const now = this.clock();
    let removed = 0;
    const entries = [...this.sessions.entries()].sort((a, b) => a[1].touched - b[1].touched);
    for (const [key, v] of entries) {
      if (now - v.touched > this.ttlMs || this.sessions.size > this.max) {
        this.sessions.delete(key);
        for (const [rk, r] of this.records) if (this.k(r.tenantId, r.sessionId) === key) this.records.delete(rk);
        removed++;
      }
    }
    return removed;
  }
  get size(): number {
    return this.sessions.size;
  }
  async getSession(tenantId: string, sessionId: string) {
    this.sweep();
    const v = this.sessions.get(this.k(tenantId, sessionId));
    if (!v) return undefined;
    v.touched = this.clock();
    return v.session;
  }
  async putSession(session: StoredSession) {
    this.assertTrial(session.tenantId);
    this.sessions.set(this.k(session.tenantId, session.sessionId), { session, touched: this.clock() });
    this.sweep();
  }
  async deleteSession(tenantId: string, sessionId: string) {
    const key = this.k(tenantId, sessionId);
    this.sessions.delete(key);
    for (const [rk, r] of this.records) if (this.k(r.tenantId, r.sessionId) === key) this.records.delete(rk);
  }
  async putRecord(r: DecisionRecord) {
    this.assertTrial(r.tenantId);
    if (r.evidenceMode !== "VISUAL") throw new Error("trial sessions cannot hold DATA decisions");
    if (!this.sessions.has(this.k(r.tenantId, r.sessionId))) return false;
    const key = this.k(r.tenantId, r.recordId);
    if (this.records.has(key)) return false;
    this.records.set(key, r);
    return true;
  }
  async listRecords(tenantId: string, filter: { symbol?: string; sessionId?: string } = {}) {
    this.sweep();
    return [...this.records.values()]
      .filter((r) => r.tenantId === tenantId && (!filter.symbol || r.symbol === filter.symbol) && (!filter.sessionId || r.sessionId === filter.sessionId))
      .sort((a, b) => a.at - b.at || (a.recordId < b.recordId ? -1 : 1));
  }
  async addAlert(_tenantId: string, _alert: StateAlert) {
    return false;
  }
  async listAlerts() {
    return [];
  }
  async addJournal(_e: JournalEntry) {
    return false;
  }
  async listJournal() {
    return [];
  }
  async getRuntimeState() {
    return null;
  }
  async putRuntimeState(_t: string, _s: RuntimeState): Promise<void> {
    throw new Error("trial sessions cannot persist runtime state");
  }
}
