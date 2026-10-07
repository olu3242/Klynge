export const KLYNGE_ENGINE_VERSION = "0.2.0";

export const KLYNGE_RULE_VERSION = "setup-engine-v1";

/** Historical rule provenance. Never delete entries — recorded decisions reference them. */
export const KLYNGE_RULE_HISTORY = Object.freeze([
  Object.freeze({ engineVersion: "0.1.0", ruleVersion: "market-truth-v1", summary: "Data quality, indicators, structure, SPX/MNQ regime, trade permission." }),
  Object.freeze({
    engineVersion: "0.2.0",
    ruleVersion: "setup-engine-v1",
    summary: "Market-context roles + volume proxy; levels, price-action lifecycle, confirmation, risk, Klynge decision.",
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
