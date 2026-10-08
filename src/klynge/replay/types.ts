import type { MarketTruthSnapshot } from "../engine/market-truth.ts";
import type { OptionChainSnapshot, OptionsDecisionState, OptionsPolicy } from "../options/types.ts";
import type { MultiTimeframePipelineInput } from "../pipeline/mtf-pipeline.ts";
import type { HigherTimeframeBias } from "../timeframe/bias.ts";
import type { MultiTimeframeState } from "../timeframe/multi-timeframe.ts";
import type { KlyngeDecision, KlyngeDecisionState } from "../triggers/types.ts";

export interface ReplayFrame {
  timestamp: number;

  marketTruth: MarketTruthSnapshot;

  multiTimeframe?: MultiTimeframeState;

  setupDecision?: KlyngeDecisionState;

  optionsDecision?: OptionsDecisionState;
}

export interface ReplayInput extends Omit<MultiTimeframePipelineInput, "now" | "previous"> {
  /** Timestamped chain snapshots; a frame only ever sees the latest snapshot taken at or before its time. */
  optionChains?: readonly OptionChainSnapshot[];
  optionsPolicy?: OptionsPolicy;
}

export interface ReplayResult {
  symbol: string;
  frames: ReplayFrame[];
}

export interface ReplayOutcome {
  setupId: string;

  decision: KlyngeDecision;

  entered: boolean;

  targetReached: boolean;
  invalidationReached: boolean;

  mae?: number;
  mfe?: number;

  realizedRewardRisk?: number;

  startedAt: number;
  resolvedAt?: number;

  direction: "CALL" | "PUT";
  entryTimestamp?: number;
  durationMs?: number;
  regime?: string;
  bias?: HigherTimeframeBias;
}
