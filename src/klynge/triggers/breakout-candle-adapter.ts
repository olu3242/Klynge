/** Breakout-candle evidence adapter.
 * This deliberately exposes only CANDIDATE / UNVERIFIED proposals to strategy arbitration.
 * No caller can promote an isolated pattern observation into a certified setup through this adapter.
 */
import type { BreakoutCandleDecision } from "../price-action/breakout-candle.ts";
import type { StrategyProposal } from "./strategy-arbitration.ts";

export interface BreakoutCandleProposalInput {
  symbol: string;
  timeframe: "5m";
  evaluatedAt: number;
  /** Stable pattern identity from the verified standout candle timestamp. */
  standoutTimestamp: number;
  decision: BreakoutCandleDecision;
  /** Explicit upstream data-quality result. */
  dataQualityVerified: boolean;
}
export function breakoutCandleToProposal(input: BreakoutCandleProposalInput): StrategyProposal {
  const { decision } = input;
  const strategy = decision.direction === "CALL" ? "K-BR-C" : "K-BD-P";
  const identityValid = Boolean(input.symbol.trim()) &&
    input.timeframe === "5m" &&
    Number.isFinite(input.evaluatedAt) &&
    Number.isFinite(input.standoutTimestamp) &&
    input.standoutTimestamp <= input.evaluatedAt - 900000;
  return {
    strategy,
    direction: decision.direction,
    evidence: identityValid && input.dataQualityVerified && decision.state === "CANDIDATE" ?
      "CANDIDATE" : "UNVERIFIED",
    symbol: input.symbol,
    timeframe: input.timeframe,
    evaluatedAt: input.evaluatedAt,
    setupId: `BC:${input.symbol}:${input.timeframe}:${input.standoutTimestamp}:${decision.direction}`
    // Never provide certifiedDecision. Only existing canonical setup engine may certify.
  };
}
