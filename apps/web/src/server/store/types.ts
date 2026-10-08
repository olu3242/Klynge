import type { ChartSession, DataHandoff, EvidenceMode, KlyngeDecisionState, MarketDataProvenance, OptionsDecisionState, RuntimeState, StateAlert, VisualContextState } from "../engine-core.ts";

/** DIRECT = created by a verified user; ANONYMOUS_TRIAL = explicitly promoted copy of a trial session. */
export type SessionOrigin = "DIRECT" | "ANONYMOUS_TRIAL";

/** A chart session as stored (engine ChartSession + ownership provenance). */
export type StoredSession = ChartSession & { origin?: SessionOrigin; promotedAt?: number };

/** Immutable engine record (one per evaluated snapshot). Annotations live separately in the journal. */
export interface DecisionRecord {
  recordId: string;
  tenantId: string;
  sessionId: string;
  symbol: string;
  timeframe: string | null;
  evidenceMode: EvidenceMode;
  at: number;
  visual?: VisualContextState;
  data?: KlyngeDecisionState;
  origin?: SessionOrigin;
  /** DATA runtime records: latest verified bar, downstream options state, provider provenance, visual hints used. */
  marketTimestamp?: number;
  runtimeId?: string;
  options?: OptionsDecisionState | null;
  marketData?: MarketDataProvenance[];
  handoff?: DataHandoff;
}

export interface JournalEntry {
  entryId: string;
  tenantId: string;
  recordId: string;
  symbol: string;
  note: string;
  author: string;
  createdAt: number;
}

/**
 * Persistence adapter. Every write is idempotent on its deterministic id.
 * DURABLE = tenant-owned (tenantId is ALWAYS a verified auth user id). TRIAL = anonymous, in-memory, short TTL;
 * a TRIAL store never holds journal entries, alerts or runtime state, and nothing in it is user-owned history.
 */
export interface SessionStore {
  readonly durability: "DURABLE" | "TRIAL";
  getSession(tenantId: string, sessionId: string): Promise<StoredSession | undefined>;
  putSession(session: StoredSession): Promise<void>;
  deleteSession(tenantId: string, sessionId: string): Promise<void>;
  /** Returns false when the record already existed (idempotent replay). */
  putRecord(record: DecisionRecord): Promise<boolean>;
  listRecords(tenantId: string, filter?: { symbol?: string; sessionId?: string }): Promise<DecisionRecord[]>;
  addAlert(tenantId: string, alert: StateAlert): Promise<boolean>;
  listAlerts(tenantId: string): Promise<StateAlert[]>;
  addJournal(entry: JournalEntry): Promise<boolean>;
  listJournal(tenantId: string, recordId?: string): Promise<JournalEntry[]>;
  getRuntimeState(tenantId: string, runtimeId: string): Promise<RuntimeState | null>;
  putRuntimeState(tenantId: string, state: RuntimeState): Promise<void>;
}

export type ImageRetention = "NONE" | "SESSION";

/** Processed (metadata-stripped) images only — raw uploads are never stored. Never persisted to the database. */
export interface ImageStore {
  readonly retention: ImageRetention;
  put(tenantId: string, sessionId: string, chartId: string, bytes: Buffer): void;
  has(tenantId: string, sessionId: string, chartId: string): boolean;
  purgeSession(tenantId: string, sessionId: string): void;
}
