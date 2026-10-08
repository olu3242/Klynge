import { deepFreeze } from "../domain/freeze.ts";
import { validateDecisionState } from "../triggers/invariants.ts";
import type { KlyngeDecisionState } from "../triggers/types.ts";
import { evaluateContract } from "./contract-evaluation.ts";
import { assertValidOptionsPolicy, DEFAULT_OPTIONS_POLICY, OPTIONS_RISK_NOTICE } from "./policy.ts";
import type { ContractEvaluation, OptionBlockerCode, OptionChainSnapshot, OptionsDecisionState, OptionsPolicy } from "./types.ts";

export interface OptionsEvaluationInput {
  /** Underlying decision from evaluateSetup / the MTF pipeline. Options never alter it. */
  setup: KlyngeDecisionState;
  chain: OptionChainSnapshot;
  now: number;
  /** Underlying price at `now` (e.g. execution-timeframe close). */
  underlyingPrice: number;
  policy?: OptionsPolicy;
}

const symOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Documented ordering of ELIGIBLE/CAUTION candidates (an ordering, never a "best" pick):
 *   1. liquidity GOOD before MARGINAL   2. lower spread%   3. DTE closest to the policy midpoint
 *   4. |delta| closest to the policy midpoint (when a delta range is configured)   5. lower premium   6. symbol
 */
export function compareCandidates(a: ContractEvaluation, b: ContractEvaluation, p: OptionsPolicy): number {
  const ma = a.metrics;
  const mb = b.metrics;
  if (!ma || !mb) return symOrder(a.contract.symbol, b.contract.symbol);
  const liq = (x: ContractEvaluation) => (x.liquidity === "GOOD" ? 0 : 1);
  const dteMid = (p.minimumDte + p.maximumDte) / 2;
  const deltaMid = p.minimumDelta !== undefined && p.maximumDelta !== undefined ? (p.minimumDelta + p.maximumDelta) / 2 : undefined;
  const deltaGap = (x: ContractEvaluation) => (deltaMid === undefined ? 0 : Math.abs(Math.abs(x.contract.delta ?? 0) - deltaMid));
  return (
    liq(a) - liq(b) ||
    ma.spreadPercent - mb.spreadPercent ||
    Math.abs(ma.dte - dteMid) - Math.abs(mb.dte - dteMid) ||
    deltaGap(a) - deltaGap(b) ||
    ma.premiumCost - mb.premiumCost ||
    symOrder(a.contract.symbol, b.contract.symbol)
  );
}

/**
 * Contract eligibility, strictly downstream of the underlying engine.
 * NO UNDERLYING SETUP = NO OPTIONS ELIGIBILITY. A poor chain never invalidates the underlying setup.
 */
export function evaluateOptions(input: OptionsEvaluationInput): Readonly<OptionsDecisionState> {
  const policy = { ...DEFAULT_OPTIONS_POLICY, ...(input.policy ?? {}) };
  assertValidOptionsPolicy(policy);
  const { setup, chain, now } = input;
  const contracts = [...chain.contracts].sort((a, b) => symOrder(a.symbol, b.symbol));
  const base = { timestamp: now, chainTimestamp: chain.timestamp, underlying: setup.symbol, underlyingDecision: setup.decision, riskNotice: OPTIONS_RISK_NOTICE };

  const rejectAll = (decision: "WAIT" | "BLOCKED", blockers: OptionBlockerCode[], reason: string): Readonly<OptionsDecisionState> =>
    deepFreeze({
      ...base,
      eligibleContracts: [],
      rejectedContracts: contracts.map((contract) => ({ contract, reasons: [reason] })),
      candidates: [],
      decision,
      reasons: [reason],
      blockers,
    });

  // 1. Underlying gate — options never look at the chain to decide direction.
  if (setup.decision !== "CALL_SETUP" && setup.decision !== "PUT_SETUP") {
    return rejectAll(setup.decision === "WAIT" ? "WAIT" : "BLOCKED", ["NO_UNDERLYING_SETUP"], `No underlying CALL_SETUP or PUT_SETUP (underlying ${setup.decision})`);
  }
  if (setup.evidenceMode !== "DATA") return rejectAll("BLOCKED", ["VISUAL_EVIDENCE"], "Options eligibility requires DATA evidence; visual observations cannot select contracts");
  const violations = validateDecisionState(setup);
  if (violations.length > 0) return rejectAll("BLOCKED", ["INVALID_UNDERLYING_DECISION"], `Underlying decision failed validation: ${violations[0]}`);
  if (chain.underlying !== setup.symbol) return rejectAll("BLOCKED", ["UNDERLYING_MISMATCH"], `Option chain is for ${chain.underlying}, not ${setup.symbol}`);
  if (!Number.isSafeInteger(chain.timestamp) || chain.timestamp > now) return rejectAll("BLOCKED", ["FUTURE_QUOTE"], "Option chain snapshot is after the evaluation time");
  if (now - chain.timestamp > (policy.maximumQuoteAgeMs ?? DEFAULT_OPTIONS_POLICY.maximumQuoteAgeMs)) return rejectAll("BLOCKED", ["STALE_CHAIN"], "Option chain snapshot is stale");
  if (!(Number.isFinite(input.underlyingPrice) && input.underlyingPrice > 0)) return rejectAll("BLOCKED", ["INVALID_QUOTE"], "Underlying price unavailable");

  // 2. Per-contract evaluation with the direction DERIVED from the underlying setup.
  const side = setup.decision === "CALL_SETUP" ? "CALL" : "PUT";
  const evaluated = contracts.map((c) => evaluateContract(c, { side, underlying: setup.symbol, underlyingPrice: input.underlyingPrice, now, policy }));
  const eligible = evaluated.filter((e) => e.riskState !== "BLOCKED").sort((a, b) => compareCandidates(a, b, policy));
  const rejected = evaluated.filter((e) => e.riskState === "BLOCKED");

  return deepFreeze({
    ...base,
    eligibleContracts: eligible.map((e) => e.contract),
    rejectedContracts: rejected.map((e) => ({ contract: e.contract, reasons: e.reasons })),
    candidates: [...eligible, ...rejected],
    decision: eligible.length > 0 ? "ELIGIBLE" : "BLOCKED",
    reasons:
      eligible.length > 0
        ? [`${eligible.length} eligible ${side} contract candidate(s) for the underlying ${setup.decision}; ordered by liquidity, spread, DTE and delta proximity. Not a recommendation.`]
        : [`No ${side} contract satisfies the options policy. The underlying ${setup.decision} is unchanged.`],
    blockers: eligible.length > 0 ? [] : ["NO_ELIGIBLE_CONTRACTS"],
  });
}
