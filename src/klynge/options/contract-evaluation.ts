import { contractMetrics } from "./metrics.ts";
import { DEFAULT_OPTIONS_POLICY, MAXIMUM_CAPITAL_AT_RISK_NOTICE } from "./policy.ts";
import type { ContractEvaluation, OptionBlockerCode, OptionContract, OptionLiquidityState, OptionsPolicy, OptionType } from "./types.ts";

export interface ContractContext {
  /** Option type derived from the underlying setup — never chosen by scanning the chain. */
  side: OptionType;
  underlying: string;
  underlyingPrice: number;
  now: number;
  policy: OptionsPolicy;
}

const fin = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const f2 = (n: number) => n.toFixed(2);

/**
 * Transparent liquidity rule (no score):
 *   GOOD     spread% <= max/2 AND volume >= 2×min AND OI >= 2×min
 *   MARGINAL spread% <= max   AND volume >= min   AND OI >= min
 *   POOR     otherwise
 */
export function classifyLiquidity(spreadPercent: number, volume: number, openInterest: number, p: OptionsPolicy): OptionLiquidityState {
  if (spreadPercent <= p.maximumSpreadPercent / 2 && volume >= 2 * p.minimumVolume && openInterest >= 2 * p.minimumOpenInterest) return "GOOD";
  if (spreadPercent <= p.maximumSpreadPercent && volume >= p.minimumVolume && openInterest >= p.minimumOpenInterest) return "MARGINAL";
  return "POOR";
}

/** Deterministic per-contract evaluation. Every rule is an independent veto. */
export function evaluateContract(c: OptionContract, ctx: ContractContext): ContractEvaluation {
  const p = ctx.policy;
  const reasons: string[] = [];
  const blockers: OptionBlockerCode[] = [];
  const block = (code: OptionBlockerCode, reason: string) => {
    if (!blockers.includes(code)) blockers.push(code);
    reasons.push(reason);
  };

  if (c.type !== ctx.side) block("WRONG_OPTION_DIRECTION", `${c.type} contract does not match the ${ctx.side === "CALL" ? "CALL_SETUP" : "PUT_SETUP"}`);
  if (c.underlying !== ctx.underlying) block("UNDERLYING_MISMATCH", `contract underlying ${c.underlying} is not ${ctx.underlying}`);

  const quoteValid =
    fin(c.bid) && fin(c.ask) && fin(c.strike) && c.strike > 0 && fin(c.volume) && c.volume >= 0 && fin(c.openInterest) && c.openInterest >= 0 &&
    Number.isSafeInteger(c.expiration) && Number.isSafeInteger(c.timestamp) && c.bid >= 0 && c.ask > 0 && (c.type === "CALL" || c.type === "PUT");
  if (!quoteValid) block("INVALID_QUOTE", "malformed quote (non-finite, negative or missing fields)");
  else {
    if (c.bid === 0) block("ZERO_BID", "zero bid: no executable two-sided market");
    if (c.bid > c.ask) block("CROSSED_MARKET", "crossed market: bid above ask");
  }
  if (Number.isSafeInteger(c.timestamp)) {
    if (c.timestamp > ctx.now) block("FUTURE_QUOTE", "quote timestamp is after the evaluation time");
    else if (ctx.now - c.timestamp > (p.maximumQuoteAgeMs ?? DEFAULT_OPTIONS_POLICY.maximumQuoteAgeMs)) block("STALE_QUOTE", "quote is stale");
  }
  if (Number.isSafeInteger(c.expiration) && c.expiration <= ctx.now) block("EXPIRED", "contract has expired");

  const metricsOk = quoteValid && c.bid <= c.ask && fin(ctx.underlyingPrice) && ctx.underlyingPrice > 0;
  const metrics = metricsOk ? contractMetrics(c, ctx.underlyingPrice, ctx.now, p.contractMultiplier ?? DEFAULT_OPTIONS_POLICY.contractMultiplier) : null;
  let liquidity: OptionLiquidityState = "POOR";

  if (metrics) {
    if (metrics.dte < p.minimumDte || metrics.dte > p.maximumDte) block("OUTSIDE_DTE_RANGE", `DTE ${f2(metrics.dte)} outside ${p.minimumDte}-${p.maximumDte}`);
    if (metrics.spreadPercent > p.maximumSpreadPercent) block("SPREAD_TOO_WIDE", `spread ${f2(metrics.spreadPercent)}% exceeds ${p.maximumSpreadPercent}%`);
    if (c.volume < p.minimumVolume) block("INSUFFICIENT_VOLUME", `volume ${c.volume} below ${p.minimumVolume}`);
    if (c.openInterest < p.minimumOpenInterest) block("INSUFFICIENT_OPEN_INTEREST", `open interest ${c.openInterest} below ${p.minimumOpenInterest}`);
    if (p.minimumDelta !== undefined || p.maximumDelta !== undefined) {
      if (!fin(c.delta)) block("DELTA_UNAVAILABLE", "delta unavailable while a delta range is required");
      else if ((c.type === "CALL" && c.delta < 0) || (c.type === "PUT" && c.delta > 0)) block("INVALID_QUOTE", "delta sign inconsistent with option type");
      else {
        const d = Math.abs(c.delta);
        if ((p.minimumDelta !== undefined && d < p.minimumDelta) || (p.maximumDelta !== undefined && d > p.maximumDelta)) block("OUTSIDE_DELTA_RANGE", `|delta| ${f2(d)} outside policy range`);
      }
    }
    if (p.maximumPremiumAtRisk !== undefined && metrics.premiumCost > p.maximumPremiumAtRisk) block("PREMIUM_EXCEEDS_POLICY", `premium at risk ${f2(metrics.premiumCost)} exceeds ${p.maximumPremiumAtRisk}`);
    liquidity = classifyLiquidity(metrics.spreadPercent, c.volume, c.openInterest, p);
    if (liquidity === "POOR") block("POOR_LIQUIDITY", "liquidity POOR");
  }

  const blocked = blockers.length > 0;
  const riskState = blocked ? "BLOCKED" : liquidity === "GOOD" ? "ELIGIBLE" : "CAUTION";
  const eligibleReasons =
    !blocked && metrics
      ? [
          `Direction ${c.type} derived from the underlying setup`,
          `DTE ${f2(metrics.dte)} within policy`,
          `Spread ${f2(metrics.spreadPercent)}% within policy`,
          liquidity === "GOOD" ? "Liquidity acceptable (GOOD)" : "Liquidity MARGINAL — use caution",
          `Premium at risk ${f2(metrics.premiumCost)}. ${MAXIMUM_CAPITAL_AT_RISK_NOTICE}`,
          `Breakeven at expiration ${f2(metrics.breakeven)}`,
          "Risk policy satisfied — contract candidate, not a recommendation",
        ]
      : [];
  if (!blocked && liquidity === "MARGINAL") reasons.push("Liquidity MARGINAL: meets minimums but not the GOOD band");
  return { contract: c, metrics, liquidity, riskState, direction: c.type, eligibleReasons, reasons, blockers };
}
