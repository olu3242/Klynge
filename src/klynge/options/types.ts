import type { KlyngeDecision } from "../triggers/types.ts";

export type OptionType = "CALL" | "PUT";

/** Vendor-neutral option quote. `expiration` and `timestamp` are epoch ms (UTC). */
export interface OptionContract {
  symbol: string;

  underlying: string;

  type: OptionType;

  strike: number;
  expiration: number;

  bid: number;
  ask: number;
  last?: number;

  volume: number;
  openInterest: number;

  impliedVolatility?: number;

  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;

  timestamp: number;
}

export interface OptionChainSnapshot {
  underlying: string;
  /** When the snapshot was taken (must be <= evaluation clock). */
  timestamp: number;
  contracts: OptionContract[];
}

export interface OptionsPolicy {
  minimumDte: number;
  maximumDte: number;

  minimumOpenInterest: number;
  minimumVolume: number;

  maximumSpreadPercent: number;

  minimumDelta?: number;
  maximumDelta?: number;

  maximumPremiumAtRisk?: number;

  /** Quotes older than this (ms) are stale. */
  maximumQuoteAgeMs?: number;
  /** Shares per contract used for premium/capital math. */
  contractMultiplier?: number;
}

export type OptionLiquidityState = "GOOD" | "MARGINAL" | "POOR";

export type OptionRiskState = "ELIGIBLE" | "CAUTION" | "BLOCKED";

export type OptionsDecision = "ELIGIBLE" | "WAIT" | "BLOCKED";

export type OptionBlockerCode =
  | "NO_UNDERLYING_SETUP"
  | "VISUAL_EVIDENCE"
  | "INVALID_UNDERLYING_DECISION"
  | "UNDERLYING_MISMATCH"
  | "WRONG_OPTION_DIRECTION"
  | "INVALID_QUOTE"
  | "ZERO_BID"
  | "CROSSED_MARKET"
  | "STALE_QUOTE"
  | "FUTURE_QUOTE"
  | "EXPIRED"
  | "OUTSIDE_DTE_RANGE"
  | "SPREAD_TOO_WIDE"
  | "INSUFFICIENT_VOLUME"
  | "INSUFFICIENT_OPEN_INTEREST"
  | "DELTA_UNAVAILABLE"
  | "OUTSIDE_DELTA_RANGE"
  | "PREMIUM_EXCEEDS_POLICY"
  | "POOR_LIQUIDITY"
  | "STALE_CHAIN"
  | "NO_ELIGIBLE_CONTRACTS";

export interface ContractMetrics {
  /** Calendar days to expiration (fractional), from the evaluation clock. */
  dte: number;
  mid: number;
  spread: number;
  spreadPercent: number;
  /** Positive = in the money (CALL: (S−K)/S, PUT: (K−S)/S), in percent. */
  moneynessPercent: number;
  /** Premium paid per contract at the ask (conservative). */
  premiumCost: number;
  breakeven: number;
  /** Long option: maximum capital at risk equals the premium paid (may be 100% loss). */
  capitalAtRisk: number;
}

export interface ContractEvaluation {
  contract: OptionContract;
  metrics: ContractMetrics | null;
  liquidity: OptionLiquidityState;
  riskState: OptionRiskState;
  direction: OptionType;
  /** Why eligible (when not BLOCKED). */
  eligibleReasons: string[];
  /** Why rejected / cautioned. */
  reasons: string[];
  blockers: OptionBlockerCode[];
}

export interface OptionsDecisionState {
  timestamp: number;

  underlying: string;

  /** Provenance: timestamp of the chain snapshot evaluated (always <= timestamp). */
  chainTimestamp: number;

  /** Underlying engine decision. Only CALL_SETUP / PUT_SETUP can ever lead to ELIGIBLE. */
  underlyingDecision: KlyngeDecision;

  eligibleContracts: OptionContract[];

  rejectedContracts: {
    contract: OptionContract;
    reasons: string[];
  }[];

  /** Full per-candidate explainability, eligible candidates first in documented order. */
  candidates: ContractEvaluation[];

  decision: OptionsDecision;

  reasons: string[];
  blockers: string[];

  riskNotice: string;
}
