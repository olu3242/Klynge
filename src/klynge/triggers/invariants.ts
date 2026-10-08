import type { SetupPolicy, KlyngeDecisionState } from "./types.ts";
import { DEFAULT_SETUP_POLICY } from "./setup-policy.ts";

/**
 * Structural invariants of a directional decision. Used by the engine before returning (programming
 * errors throw) and by agent governance to reject forged states. Returns violations (empty = consistent).
 */
export function validateDecisionState(s: KlyngeDecisionState, policy: SetupPolicy = DEFAULT_SETUP_POLICY): string[] {
  if (s.decision !== "CALL_SETUP" && s.decision !== "PUT_SETUP") return [];
  const call = s.decision === "CALL_SETUP";
  const v: string[] = [];
  const req = (ok: boolean, msg: string) => {
    if (!ok) v.push(msg);
  };
  req(s.regime === (call ? "RISK_ON" : "RISK_OFF"), `regime must be ${call ? "RISK_ON" : "RISK_OFF"}`);
  req(s.marketAligned === true, "market must be aligned");
  req(s.targetDirection === (call ? "BULLISH" : "BEARISH"), `target must be ${call ? "BULLISH" : "BEARISH"}`);
  for (const [stage, ok] of Object.entries(s.progress)) req(ok === true, `progress.${stage} must be complete`);
  req(s.level !== undefined && s.level.confirmed && s.level.strength !== "WEAK", "valid level required");
  req(s.priceActionState === "CONFIRMED", "price action must be CONFIRMED");
  req(s.confirmationState === "CONFIRMED", "confirmation must be CONFIRMED");
  req(s.risk?.allowed === true, "risk must be allowed");
  req(s.risk?.invalidation !== undefined, "explicit invalidation required");
  req(s.risk?.target !== undefined, "valid target required");
  req((s.risk?.rewardRiskRatio ?? 0) >= policy.risk.minimumRewardRiskRatio, "minimum reward/risk required");
  req(s.blockers.length === 0, "no blockers allowed");
  req(s.invalidationReasons.length === 0, "no invalidation allowed");
  req(s.setup !== undefined && s.setup.direction === (call ? "CALL" : "PUT"), "setup identity must match direction");
  if (s.multiTimeframe) {
    const m = s.multiTimeframe;
    req(m.synchronized, "multi-timeframe context must be synchronized");
    req(m.biasApproved && m.bias !== "CONFLICTED" && m.bias !== (call ? "BEARISH" : "BULLISH"), "higher-timeframe bias must not conflict");
    req(m.executionConfirmed && m.executionDirection !== (call ? "BEARISH" : "BULLISH"), "execution timeframe must confirm");
  }
  return v;
}

export function isDirectionalDecision(s: Pick<KlyngeDecisionState, "decision">): boolean {
  return s.decision === "CALL_SETUP" || s.decision === "PUT_SETUP";
}
