import type { EvidenceMode } from "../domain/types.ts";
import type { ProviderFailure } from "../providers/types.ts";
import type { KlyngeDecisionState } from "../triggers/types.ts";
import type { VisualContextState } from "../visual/visual-context.ts";

export type AlertSeverity = "INFO" | "ATTENTION" | "WARNING";

/** What changed. Alerts reflect engine/runtime state; they never create it. */
export type AlertEvent =
  | "VISUAL_CONTEXT_COMPLETE"
  | "VISUAL_CONTEXT_INCOMPLETE"
  | "DATA_VERIFIED"
  | "RISK_ON"
  | "RISK_OFF"
  | "MIXED"
  | "SETUP_WAIT"
  | "CALL_SETUP"
  | "PUT_SETUP"
  | "BLOCKED"
  | "INVALIDATED"
  | "OPTIONS_ELIGIBLE"
  | "OPTIONS_BLOCKED"
  | "PROVIDER_FAILURE";

export interface StateAlert {
  /** Deterministic idempotency key: SYMBOL:MODE:FROM->TO:AT. */
  alertId: string;
  event: AlertEvent;
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
  const event: AlertEvent = next.decision === "WAIT" ? "SETUP_WAIT" : next.decision;
  return {
    alertId: key(next.symbol, "DATA", from, next.decision, next.provenance.evaluatedAt),
    event,
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
  const event: AlertEvent = next.permission === "BLOCKED" ? "BLOCKED" : next.label === "INSUFFICIENT CONTEXT" ? "VISUAL_CONTEXT_INCOMPLETE" : "VISUAL_CONTEXT_COMPLETE";
  return {
    alertId: key(symbol, "VISUAL", from, to, next.timestamp),
    event,
    symbol,
    evidenceMode: "VISUAL",
    from,
    to,
    at: next.timestamp,
    severity: next.permission === "BLOCKED" ? "WARNING" : "INFO",
    message: `${symbol}: visual context ${to}. ${next.notice}.`,
  };
}

/** First verified DATA decision for a symbol in this lineage (VISUAL → DATA handoff made visible). */
export function detectDataVerified(prev: KlyngeDecisionState | undefined, next: KlyngeDecisionState): StateAlert | null {
  if (prev) return null;
  const at = next.provenance.evaluatedAt;
  return {
    alertId: `${next.symbol}:DATA:DATA_VERIFIED:${at}`,
    event: "DATA_VERIFIED",
    symbol: next.symbol,
    evidenceMode: "DATA",
    from: null,
    to: "DATA_VERIFIED",
    at,
    severity: "INFO",
    message: `${next.symbol}: verified market data connected. Deterministic Klynge engine active.`,
  };
}

/** Market regime change on DATA (RISK_ON / RISK_OFF / MIXED). UNKNOWN surfaces through the BLOCKED decision. */
export function detectRegimeChange(prev: KlyngeDecisionState | undefined, next: KlyngeDecisionState): StateAlert | null {
  if (!prev || prev.regime === next.regime || next.regime === "UNKNOWN") return null;
  const at = next.provenance.evaluatedAt;
  return {
    alertId: key(next.symbol, "DATA", `REGIME:${prev.regime}`, `REGIME:${next.regime}`, at),
    event: next.regime,
    symbol: next.symbol,
    evidenceMode: "DATA",
    from: prev.regime,
    to: next.regime,
    at,
    severity: next.regime === "MIXED" ? "WARNING" : "INFO",
    message: `${next.symbol}: market regime ${prev.regime} → ${next.regime}. Not a recommendation.`,
  };
}

/**
 * Provider failure. Keyed on the last processed market timestamp so repeating the same failure for the same
 * market state never duplicates the alert.
 */
export function providerFailureAlert(symbol: string, failures: readonly ProviderFailure[], permission: "WAIT" | "BLOCKED", lastMarketTimestamp: number | null, at: number): StateAlert {
  const codes = [...new Set(failures.map((f) => f.code))].sort().join("+");
  return {
    alertId: `${symbol}:DATA:PROVIDER_FAILURE:${codes}:${lastMarketTimestamp ?? "NONE"}`,
    event: "PROVIDER_FAILURE",
    symbol,
    evidenceMode: "DATA",
    from: null,
    to: permission,
    at,
    severity: permission === "BLOCKED" ? "WARNING" : "INFO",
    message: `${symbol}: market data unavailable or unverified (${codes}). ${permission} until verified data returns.`,
  };
}
