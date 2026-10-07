import type { Direction, MarketRegime, Timeframe } from "../domain/types.ts";
import type { ConfirmationQuality, ConfirmationState } from "../confirmation/confirmation.ts";
import type { DecisionProvenance } from "../engine/version.ts";
import type { LevelPolicy, PriceLevel } from "../levels/types.ts";
import type { AcceptancePolicy, BreakPolicy, PriceActionState, PriceActionTransition, RetestPolicy } from "../price-action/types.ts";
import type { RiskPolicy, RiskState } from "../risk/risk-engine.ts";

export type KlyngeDecision = "CALL_SETUP" | "PUT_SETUP" | "WAIT" | "BLOCKED" | "INVALIDATED";

export type SetupBlockerCode = "TARGET_REGIME_CONFLICT" | "PRIOR_SESSION_INVALID" | "MULTI_TIMEFRAME_UNSUPPORTED";

export interface SetupProgress {
  marketTruth: boolean;
  targetDirection: boolean;
  level: boolean;
  break: boolean;
  acceptance: boolean;
  retest: boolean;
  confirmation: boolean;
  risk: boolean;
}

export interface SetupIdentity {
  /** Deterministic: SYMBOL:TF:CALL|PUT:LEVEL_ID:STARTED_AT. */
  setupId: string;

  symbol: string;
  timeframe: Timeframe;

  direction: "CALL" | "PUT";

  levelId: string;

  /** Timestamp of the break candle that started the lifecycle. */
  startedAt: number;
}

/** Every state explains itself: what is happening, why, what is missing, what invalidates it, which risk blocker applies. */
export interface SetupExplanation {
  summary: string;
  missing: string[];
  invalidatesIf: string[];
  riskBlockers: string[];
}

export interface KlyngeDecisionState {
  symbol: string;
  timeframe: Timeframe;
  timestamp: number;

  decision: KlyngeDecision;

  regime: MarketRegime;

  marketAligned: boolean;

  targetDirection: Direction;

  level?: PriceLevel;

  priceActionState?: PriceActionState;

  confirmationState?: ConfirmationState;
  confirmationQuality?: ConfirmationQuality;

  risk?: RiskState;

  reasons: string[];
  blockers: string[];

  invalidationReasons: string[];

  progress: SetupProgress;
  setup?: SetupIdentity;
  transitions: PriceActionTransition[];
  explanation: SetupExplanation;
  provenance: DecisionProvenance;
}

export interface SetupPolicy {
  levels: LevelPolicy;
  break: BreakPolicy;
  acceptance: AcceptancePolicy;
  retest: RetestPolicy;
  risk: RiskPolicy;
  swingLookback: number;
}
