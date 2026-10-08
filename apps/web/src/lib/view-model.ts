/**
 * View models shared with client components. Plain data only — no engine imports, so no engine code can reach
 * the client bundle through these types.
 */
export type ProvenanceView = "DATA_VERIFIED" | "OBSERVED" | "USER_CONFIRMED" | "NOT_VISIBLE" | "NOT_PROVIDED" | "NOT_VERIFIED";
export type RoleView = "TARGET" | "SPX" | "MNQ" | "VOLUME_PROXY";

export interface FieldView {
  field: string;
  label: string;
  value: string | null;
  status: ProvenanceView;
  confidence: number;
  required: boolean;
  /** Raw value as JSON-safe data for editing. */
  editable: boolean;
}

export interface ChartView {
  chartId: string;
  role: RoleView;
  roleSource: "DETECTED" | "USER";
  roleViolation: string | null;
  symbol: string | null;
  captureTime: number;
  captureTimeSource: "UPLOAD" | "AXIS_CONFIRMED";
  fields: FieldView[];
  issues: string[];
  confirmations: number;
}

export interface VisualContextView {
  evidenceMode: "VISUAL";
  label: string;
  targetContext: string;
  permission: "WAIT" | "BLOCKED";
  regime: string;
  notice: string;
  observed: string[];
  notVerified: string[];
  missing: string[];
  nextSteps: string[];
  reasons: string[];
  blockers: string[];
  timestamp: number;
}

export interface DataDecisionView {
  evidenceMode: "DATA";
  symbol: string;
  timeframe: string;
  decision: string;
  regime: string;
  targetDirection: string;
  priceActionState: string | null;
  confirmationState: string | null;
  progress: { stage: string; done: boolean }[];
  summary: string;
  reasons: string[];
  blockers: string[];
  missing: string[];
  invalidatesIf: string[];
  risk: { allowed: boolean; level: string; entryZone: string | null; invalidation: string | null; target: string | null; rewardRisk: string | null } | null;
  asOf: number;
}

export interface AlertView {
  alertId: string;
  symbol: string;
  evidenceMode: string;
  severity: string;
  message: string;
  at: number;
}

export interface JournalView {
  entryId: string;
  recordId: string;
  note: string;
  createdAt: number;
}

export interface HistoryRowView {
  recordId: string;
  symbol: string;
  evidenceMode: "VISUAL" | "DATA";
  state: string;
  permission: string;
  at: number;
  notes: number;
}

export interface WorkspaceView {
  sessionId: string;
  charts: ChartView[];
  completeness: { role: RoleView; present: boolean; symbol: string | null }[];
  visual: VisualContextView | null;
  data: DataDecisionView | null;
  latestRecordId: string | null;
  alerts: AlertView[];
  journal: JournalView[];
}
