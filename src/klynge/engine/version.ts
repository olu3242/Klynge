export const KLYNGE_ENGINE_VERSION = "0.8.0";

export const KLYNGE_RULE_VERSION = "pilot-operations-v1";

/** Historical rule provenance. Never delete entries — recorded decisions reference them. */
export const KLYNGE_RULE_HISTORY = Object.freeze([
  Object.freeze({ engineVersion: "0.1.0", ruleVersion: "market-truth-v1", summary: "Data quality, indicators, structure, SPX/MNQ regime, trade permission." }),
  Object.freeze({
    engineVersion: "0.2.0",
    ruleVersion: "setup-engine-v1",
    summary: "Market-context roles + volume proxy; levels, price-action lifecycle, confirmation, risk, Klynge decision.",
  }),
  Object.freeze({
    engineVersion: "0.3.0",
    ruleVersion: "mtf-options-v1",
    summary: "Multi-session warm-up, timeframe hierarchy, HTF bias gate, execution context, replay, calibration, options eligibility.",
  }),
  Object.freeze({
    engineVersion: "0.4.0",
    ruleVersion: "visual-intake-v1",
    summary: "Evidence modes (VISUAL/DATA), field provenance, visual validation + context, chart sessions, confirmations, snapshots, alerts.",
  }),
  Object.freeze({
    engineVersion: "0.5.0",
    ruleVersion: "auth-live-data-v1",
    summary: "Provider contracts, symbol mapping, feed normalization + provenance, fail-closed provider failures, DATA runtime with restored lifecycle memory, idempotency, restart recovery, visual→data handoff (hints only), runtime alerts.",
  }),
  Object.freeze({
    engineVersion: "0.6.0",
    ruleVersion: "production-calibration-v1",
    summary: "Exchange calendars (NYSE/CME, DST, holidays, fail-closed coverage), market-closed handling, dataset manifests + SHA-256, report-only sensitivity calibration with human-approved policy proposals, event-driven hypothetical backtests, user risk policies (restrict-only).",
  }),
  Object.freeze({
    engineVersion: "0.7.0",
    ruleVersion: "pilot-readiness-v1",
    summary: "CME futures front-contract selection + rollover (no NQ substitution), session-aligned bar aggregation (never filled), dataset versions + corporate-action flags, empirical decision analytics, sealed chronological holdout, cost sensitivity, out-of-sample reports (no performance or significance claims). Decision thresholds unchanged.",
  }),
  Object.freeze({
    engineVersion: "0.8.0",
    ruleVersion: "pilot-operations-v1",
    summary: "Controlled pilot operations: invite-only enrollment, onboarding, evidence ledger, feedback + triage, pilot analytics, failure injection, privacy controls, admin control plane, release manifests with policy fingerprints. Deterministic policy defaults unchanged (identical fingerprint).",
  }),
] as const);

/** Attached to every deterministic output so decisions can be traced to the exact rules that produced them. */
export interface DecisionProvenance {
  engineVersion: typeof KLYNGE_ENGINE_VERSION;
  ruleVersion: typeof KLYNGE_RULE_VERSION;
  /** Explicit evaluation clock supplied by the caller (never wall-clock inside the engine). */
  evaluatedAt: number;
}

export function provenance(evaluatedAt: number): DecisionProvenance {
  return { engineVersion: KLYNGE_ENGINE_VERSION, ruleVersion: KLYNGE_RULE_VERSION, evaluatedAt };
}
