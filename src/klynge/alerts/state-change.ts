import type { EvidenceMode } from "../domain/types.ts";
import type { KlyngeDecisionState } from "../triggers/types.ts";
import type { VisualContextState } from "../visual/visual-context.ts";

export type AlertSeverity = "INFO" | "ATTENTION" | "WARNING";

export interface StateAlert {
  /** Deterministic idempotency key: SYMBOL:MODE:FROM->TO:AT. */
  alertId: string;
  symbol: string;
  evidenceMode: EvidenceMode;
  from: string | null;
  to: string;
  at: number;
  severity: AlertSeverity;
  message: string;
}

const key = (symbol: string, mode: EvidenceMode, from: string | null, to: string, at: number) => `${symbol}:${mode}:${from ?? "NONE"}->${to}:${at}`;

/** DATA decision change. Returns null when the state did not change (no alert). */
export function detectDecisionChange(prev: KlyngeDecisionState | undefined, next: KlyngeDecisionState): StateAlert | null {
  const from = prev?.decision ?? null;
  if (from === next.decision) return null;
  const severity: AlertSeverity =
    next.decision === "CALL_SETUP" || next.decision === "PUT_SETUP" ? "ATTENTION" : next.decision === "INVALIDATED" || (next.decision === "BLOCKED" && from !== null) ? "WARNING" : "INFO";
  return {
    alertId: key(next.symbol, "DATA", from, next.decision, next.provenance.evaluatedAt),
    symbol: next.symbol,
    evidenceMode: "DATA",
    from,
    to: next.decision,
    at: next.provenance.evaluatedAt,
    severity,
    message: `${next.symbol}: ${from ?? "no prior state"} → ${next.decision}. ${next.explanation.summary} Not a recommendation.`,
  };
}

/** VISUAL context change (label or permission). Never phrased as a setup. */
export function detectVisualChange(prev: VisualContextState | undefined, next: VisualContextState): StateAlert | null {
  const state = (s: VisualContextState) => `${s.label}/${s.permission}`;
  const from = prev ? state(prev) : null;
  const to = state(next);
  if (from === to) return null;
  const symbol = next.targetSymbol ?? "UNKNOWN";
  return {
    alertId: key(symbol, "VISUAL", from, to, next.timestamp),
    symbol,
    evidenceMode: "VISUAL",
    from,
    to,
    at: next.timestamp,
    severity: next.permission === "BLOCKED" ? "WARNING" : "INFO",
    message: `${symbol}: visual context ${to}. ${next.notice}.`,
  };
}
