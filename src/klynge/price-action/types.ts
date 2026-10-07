export type PriceActionState = "WAITING" | "TESTING" | "BROKEN" | "ACCEPTED" | "RETESTING" | "CONFIRMED" | "FAILED" | "INVALIDATED";

export type SetupSide = "BULLISH" | "BEARISH";

export interface BreakPolicy {
  /** A break requires a CLOSE beyond the level by at least this × ATR. Wicks never count. */
  minimumCloseDistanceAtr: number;
}

export interface AcceptancePolicy {
  /** Consecutive closes beyond the level required AFTER the break candle (integer >= 1). */
  requiredCloses: number;
  /** A close back through the level by more than this × ATR fails the sequence. */
  maximumFailureDistanceAtr: number;
}

export interface RetestPolicy {
  /** Return within this × ATR of the broken level counts as a retest. */
  toleranceAtr: number;
  /** A retest probing deeper than this × ATR through the level is a failed retest. */
  maximumDepthAtr: number;
}

export interface PriceActionPolicy {
  break: BreakPolicy;
  acceptance: AcceptancePolicy;
  retest: RetestPolicy;
  /** Touch tolerance for TESTING (× ATR); shared with level clustering tolerance. */
  touchToleranceAtr: number;
  /** Structural invalidation sits this × ATR beyond the retest extreme / level. */
  invalidationToleranceAtr: number;
}

export const DEFAULT_BREAK_POLICY: Readonly<BreakPolicy> = Object.freeze({ minimumCloseDistanceAtr: 0.1 });
export const DEFAULT_ACCEPTANCE_POLICY: Readonly<AcceptancePolicy> = Object.freeze({ requiredCloses: 2, maximumFailureDistanceAtr: 0.25 });
export const DEFAULT_RETEST_POLICY: Readonly<RetestPolicy> = Object.freeze({ toleranceAtr: 0.25, maximumDepthAtr: 0.5 });

export interface PriceActionTransition {
  from: PriceActionState;
  to: PriceActionState;
  index: number;
  timestamp: number;
  reason: string;
}

/** One break-to-outcome lifecycle on one level. A new lifecycle only starts with a fresh break. */
export interface PriceActionLifecycle {
  levelId: string;
  levelPrice: number;
  side: SetupSide;
  state: PriceActionState;
  startedAt: number;
  breakIndex: number;
  acceptanceCloses: number;
  acceptedAt?: number;
  retestStartedAt?: number;
  /** Most adverse price reached during the retest (low for bullish, high for bearish). */
  retestExtreme?: number;
  confirmedAt?: number;
  continuationIndex?: number;
  /** Structural invalidation fixed at confirmation. */
  invalidation?: number;
  endedAt?: number;
  endReason?: string;
  transitions: PriceActionTransition[];
}

export interface PriceActionResult {
  levelId: string;
  side: SetupSide;
  state: PriceActionState;
  lifecycles: PriceActionLifecycle[];
  transitions: PriceActionTransition[];
}
