export const KLYNGE_ENGINE_VERSION = "0.1.0";

export const KLYNGE_RULE_VERSION = "market-truth-v1";

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
