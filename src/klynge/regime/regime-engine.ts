import { deepFreeze } from "../domain/freeze.ts";
import type { BlockerCode } from "../domain/blockers.ts";
import type { Direction, MarketRegime, RegimeState, TechnicalState } from "../domain/types.ts";
import { classifyDirection } from "../engine/direction.ts";
import { DEFAULT_DATA_QUALITY_POLICY } from "../policies/data-quality-policy.ts";
import type { DataQualityPolicy } from "../policies/data-quality-policy.ts";

/** Pure label mapping. Only BULLISH/BULLISH and BEARISH/BEARISH are aligned. */
export function regimeFromDirections(spx: Direction, mnq: Direction): { regime: MarketRegime; aligned: boolean } {
  if (spx === "BULLISH" && mnq === "BULLISH") return { regime: "RISK_ON", aligned: true };
  if (spx === "BEARISH" && mnq === "BEARISH") return { regime: "RISK_OFF", aligned: true };
  return { regime: "MIXED", aligned: false };
}

function state(timestamp: number, spx: Direction, mnq: Direction, regime: MarketRegime, aligned: boolean, reasons: string[], blockers: BlockerCode[]): Readonly<RegimeState> {
  return deepFreeze({ timestamp, spx, mnq, aligned, regime, reasons, blockers });
}

/** UNKNOWN regime for when technical states could not be built. */
export function unknownRegime(timestamp: number, reasons: string[], blockers: BlockerCode[] = []): Readonly<RegimeState> {
  const b: BlockerCode[] = blockers.includes("UNKNOWN_REGIME") ? blockers : ["UNKNOWN_REGIME", ...blockers];
  return state(timestamp, "NEUTRAL", "NEUTRAL", "UNKNOWN", false, reasons, b);
}

/**
 * SPX + MNQ regime. Synchronization is validated first: skew beyond policy => UNKNOWN.
 */
export function evaluateRegime(spx: TechnicalState, mnq: TechnicalState, policy: DataQualityPolicy = DEFAULT_DATA_QUALITY_POLICY): Readonly<RegimeState> {
  const timestamp = Math.max(spx.timestamp, mnq.timestamp);
  const spxDir = classifyDirection(spx);
  const mnqDir = classifyDirection(mnq);

  if (!Number.isFinite(spx.timestamp) || !Number.isFinite(mnq.timestamp)) {
    return unknownRegime(Number.isFinite(timestamp) ? timestamp : 0, ["snapshot timestamp unavailable"], ["NO_DATA"]);
  }
  const skew = Math.abs(spx.timestamp - mnq.timestamp);
  if (skew > policy.maxMarketSnapshotSkewMs) {
    return unknownRegime(timestamp, [`SPX/MNQ snapshots out of sync by ${skew}ms`], ["TIMESTAMP_SKEW"]);
  }
  if (spx.timeframe !== mnq.timeframe) {
    return unknownRegime(timestamp, [`SPX/MNQ timeframes differ (${spx.timeframe} vs ${mnq.timeframe})`], ["MIXED_SERIES"]);
  }

  const { regime, aligned } = regimeFromDirections(spxDir, mnqDir);
  if (regime === "MIXED") {
    return state(timestamp, spxDir, mnqDir, regime, aligned, [`market divergence: SPX ${spxDir}, MNQ ${mnqDir}`], ["MIXED_REGIME", "REGIME_NOT_ALIGNED"]);
  }
  return state(timestamp, spxDir, mnqDir, regime, aligned, [`SPX and MNQ aligned ${spxDir}`], []);
}
