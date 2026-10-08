import type { ChartSession, EvidenceMode, KlyngeDecisionState, StateAlert, VisualContextState } from "../engine-core.ts";

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

/** Persistence adapter. Every write is idempotent on its deterministic id. */
export interface SessionStore {
  getSession(tenantId: string, sessionId: string): Promise<ChartSession | undefined>;
  putSession(session: ChartSession): Promise<void>;
  deleteSession(tenantId: string, sessionId: string): Promise<void>;
  /** Returns false when the record already existed (idempotent replay). */
  putRecord(record: DecisionRecord): Promise<boolean>;
  listRecords(tenantId: string, filter?: { symbol?: string; sessionId?: string }): Promise<DecisionRecord[]>;
  addAlert(tenantId: string, alert: StateAlert): Promise<boolean>;
  listAlerts(tenantId: string): Promise<StateAlert[]>;
  addJournal(entry: JournalEntry): Promise<boolean>;
  listJournal(tenantId: string, recordId?: string): Promise<JournalEntry[]>;
}

export type ImageRetention = "NONE" | "SESSION";

/** Processed (metadata-stripped) images only — raw uploads are never stored. Never persisted to the database. */
export interface ImageStore {
  readonly retention: ImageRetention;
  put(tenantId: string, sessionId: string, chartId: string, bytes: Buffer): void;
  has(tenantId: string, sessionId: string, chartId: string): boolean;
  purgeSession(tenantId: string, sessionId: string): void;
}
