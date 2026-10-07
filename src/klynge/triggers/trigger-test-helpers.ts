import { BULL_BARS, scenario } from "../setup-test-fixtures.ts";
import type { ScenarioOptions } from "../setup-test-fixtures.ts";
import { evaluateSetup } from "./setup-engine.ts";
import { DEFAULT_SETUP_POLICY } from "./setup-policy.ts";
import type { KlyngeDecisionState, SetupPolicy } from "./types.ts";

export type Bar = [number, number, number, number];

export function evaluate(o: ScenarioOptions = {}, extra: { policy?: SetupPolicy; previous?: KlyngeDecisionState } = {}) {
  const s = scenario(o);
  return evaluateSetup({ marketTruth: s.marketTruth, target: s.target, now: s.now, ...(s.priorSession ? { priorSession: s.priorSession } : {}), ...extra });
}

export const patch = (i: number, b: Bar, bars: readonly Bar[] = BULL_BARS) => bars.map((x, j) => (j === i ? b : x));

export const riskPolicy = (o: Partial<SetupPolicy["risk"]>): SetupPolicy => ({ ...DEFAULT_SETUP_POLICY, risk: { ...DEFAULT_SETUP_POLICY.risk, ...o } });

// Single-condition removals (bullish fixture indices: break 23, acceptance 24-25, retest 26, continuation 27).
export const NO_ACCEPTANCE = patch(24, [102.4, 102.5, 101.95, 102.0]);
export const NO_RETEST = patch(26, [102.45, 102.5, 102.3, 102.4]);
export const NO_CONTINUATION = patch(27, [102.15, 102.45, 102.1, 102.4]);
export const NO_LEVEL = patch(18, [101.7, 101.75, 101.4, 101.5]);
export const NEUTRAL_TARGET = patch(20, [101.4, 101.5, 100.3, 101.1]); // lower low => structure MIXED
export const FAILED_RETEST = patch(26, [102.45, 102.5, 101.75, 101.8]).slice(0, 27);
export const ACCEPTANCE_FAILURE = patch(24, [102.4, 102.5, 101.65, 101.7]).slice(0, 25);
export const RETEST_TOO_DEEP = patch(26, [102.45, 102.5, 101.5, 102.1]).slice(0, 27);
export const INVALIDATION_BREACH: Bar[] = [...BULL_BARS, [102.55, 102.6, 101.6, 101.7]];
