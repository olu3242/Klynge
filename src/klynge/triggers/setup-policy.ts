import { assertValidLevelPolicy, DEFAULT_LEVEL_POLICY } from "../levels/types.ts";
import { DEFAULT_ACCEPTANCE_POLICY, DEFAULT_BREAK_POLICY, DEFAULT_RETEST_POLICY } from "../price-action/types.ts";
import type { PriceActionPolicy } from "../price-action/types.ts";
import { assertValidRiskPolicy, DEFAULT_RISK_POLICY } from "../risk/risk-engine.ts";
import type { SetupPolicy } from "./types.ts";

export const DEFAULT_SETUP_POLICY: Readonly<SetupPolicy> = Object.freeze({
  levels: DEFAULT_LEVEL_POLICY,
  break: DEFAULT_BREAK_POLICY,
  acceptance: DEFAULT_ACCEPTANCE_POLICY,
  retest: DEFAULT_RETEST_POLICY,
  risk: DEFAULT_RISK_POLICY,
  swingLookback: 2,
});

export function assertValidSetupPolicy(p: SetupPolicy): void {
  assertValidLevelPolicy(p.levels);
  assertValidRiskPolicy(p.risk);
  const nums: [string, number][] = [
    ["break.minimumCloseDistanceAtr", p.break.minimumCloseDistanceAtr],
    ["acceptance.maximumFailureDistanceAtr", p.acceptance.maximumFailureDistanceAtr],
    ["retest.toleranceAtr", p.retest.toleranceAtr],
    ["retest.maximumDepthAtr", p.retest.maximumDepthAtr],
  ];
  for (const [k, v] of nums) if (!Number.isFinite(v) || v < 0) throw new RangeError(`SetupPolicy.${k} must be a finite, non-negative number`);
  if (!Number.isSafeInteger(p.acceptance.requiredCloses) || p.acceptance.requiredCloses < 1) throw new RangeError("SetupPolicy.acceptance.requiredCloses must be an integer >= 1");
  if (!Number.isSafeInteger(p.swingLookback) || p.swingLookback < 1) throw new RangeError("SetupPolicy.swingLookback must be an integer >= 1");
}

/** Single mapping from setup policy to the price-action machine (one source for shared tolerances). */
export function priceActionPolicyOf(p: SetupPolicy): PriceActionPolicy {
  return {
    break: p.break,
    acceptance: p.acceptance,
    retest: p.retest,
    touchToleranceAtr: p.levels.atrToleranceMultiplier,
    invalidationToleranceAtr: p.risk.invalidationToleranceAtr,
  };
}
