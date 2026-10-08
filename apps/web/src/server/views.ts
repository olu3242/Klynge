import { OBSERVATION_FIELDS, REQUIRED_FIELDS } from "./engine-core.ts";
import type { ChartEntry, ChartSession, KlyngeDecisionState, StateAlert, VisualContextState } from "./engine-core.ts";
import type { ChartView, DataDecisionView, FieldView, VisualContextView } from "../lib/view-model.ts";
import { missingContext } from "./engine-core.ts";

const LABELS: Record<string, string> = {
  symbol: "Symbol",
  timeframe: "Timeframe",
  lastPrice: "Current price",
  priceAxisRange: "Price axis",
  vwapVisible: "VWAP",
  priceVsVwap: "Price vs VWAP",
  emaRelation: "Labelled EMA",
  structure: "Structure",
  levels: "Visible levels",
  volumeVisibility: "Volume",
  chartTime: "Chart time",
};

function fmt(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isInteger(v) && v > 1e11 ? new Date(v).toISOString().replace(".000Z", "Z") : String(Number(v.toFixed(4)));
  if (typeof v === "boolean") return v ? "Visible" : "Not visible";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map((l: { kind: string; price: number }) => `${l.kind.toLowerCase()} ${l.price}`).join(", ") || "none";
  const o = v as Record<string, unknown>;
  if ("min" in o) return `${o.min} – ${o.max}`;
  if ("relation" in o) return `${String(o.relation).toLowerCase()} ${String(o.label)}`;
  return JSON.stringify(v);
}

export function chartView(c: ChartEntry): ChartView {
  const required = REQUIRED_FIELDS[c.role];
  const fields: FieldView[] = OBSERVATION_FIELDS.map((f) => {
    const o = c.observation[f];
    return { field: f, label: LABELS[f] ?? f, value: fmt(o.value), status: o.status, confidence: o.confidence, required: required.includes(f), editable: f !== "levels" };
  });
  return {
    chartId: c.chartId,
    role: c.role,
    roleSource: c.roleSource,
    roleViolation: c.roleViolation ?? null,
    symbol: typeof c.observation.symbol.value === "string" ? c.observation.symbol.value : null,
    captureTime: c.captureTime,
    captureTimeSource: c.captureTimeSource,
    fields,
    issues: c.issues,
    confirmations: c.audit.length,
  };
}

export function completenessView(session: ChartSession) {
  return missingContext(session).charts;
}

export function visualView(s: VisualContextState): VisualContextView {
  return {
    evidenceMode: "VISUAL",
    label: s.label,
    targetContext: s.targetContext,
    permission: s.permission,
    regime: s.regime,
    notice: s.notice,
    observed: s.observed,
    notVerified: s.notVerified,
    missing: s.missing,
    nextSteps: s.nextSteps,
    reasons: s.reasons,
    blockers: s.blockers,
    timestamp: s.timestamp,
  };
}

const STAGE_LABELS: [keyof KlyngeDecisionState["progress"], string][] = [
  ["marketTruth", "Market context"],
  ["targetDirection", "Target direction"],
  ["level", "Level"],
  ["break", "Break"],
  ["acceptance", "Acceptance"],
  ["retest", "Retest"],
  ["confirmation", "Confirmation"],
  ["risk", "Risk"],
];
const n = (x: number | undefined) => (x === undefined ? null : x.toFixed(2));

export function dataView(d: KlyngeDecisionState): DataDecisionView {
  const r = d.risk;
  return {
    evidenceMode: "DATA",
    symbol: d.symbol,
    timeframe: d.timeframe,
    decision: d.decision,
    regime: d.regime,
    targetDirection: d.targetDirection,
    priceActionState: d.priceActionState ?? null,
    confirmationState: d.confirmationState ?? null,
    progress: STAGE_LABELS.map(([k, stage]) => ({ stage, done: d.progress[k] })),
    summary: d.explanation.summary,
    reasons: d.reasons,
    blockers: d.blockers,
    missing: d.explanation.missing,
    invalidatesIf: d.explanation.invalidatesIf,
    risk: r
      ? {
          allowed: r.allowed,
          level: r.level,
          entryZone: r.entryZone ? `${n(r.entryZone.min)} – ${n(r.entryZone.max)}` : null,
          invalidation: n(r.invalidation),
          target: n(r.target),
          rewardRisk: r.rewardRiskRatio === undefined ? null : r.rewardRiskRatio.toFixed(2),
        }
      : null,
    asOf: d.provenance.evaluatedAt,
  };
}

export function alertView(a: StateAlert) {
  return { alertId: a.alertId, symbol: a.symbol, evidenceMode: a.evidenceMode, severity: a.severity, message: a.message, at: a.at };
}
