import { ABSOLUTE_BLOCKER_CATEGORIES, BLOCKER_CATEGORY, BLOCKER_CODES, mergeUnique } from "../domain/blockers.ts";
import type { BlockerCode } from "../domain/blockers.ts";
import { deepFreeze } from "../domain/freeze.ts";
import type { DataQualityState, RegimeState, TradePermissionResult } from "../domain/types.ts";
import { regimeFromDirections } from "../regime/regime-engine.ts";

/**
 * THE canonical trade-permission policy. No UI, agent or downstream engine may re-implement it.
 * Fail-closed: ENABLED only when every required condition positively passes.
 */
export function evaluateTradePermission(regime: RegimeState, dataQuality: DataQualityState): Readonly<TradePermissionResult> {
  const blockers: BlockerCode[] = [];
  const reasons: string[] = [];
  const block = (code: BlockerCode, reason: string) => {
    blockers.push(code);
    reasons.push(reason);
  };

  // Data quality — check flags independently of `blockers` (defense in depth against forged/partial states).
  if (dataQuality.stale) block("STALE_DATA", "market data is stale");
  if (dataQuality.missingCandles) block("MISSING_CANDLES", "candles are missing");
  if (dataQuality.timestampSkew) block("TIMESTAMP_SKEW", "market snapshots are out of sync");
  if (!dataQuality.sufficientHistory) block("INSUFFICIENT_HISTORY", "insufficient candle history");
  if (dataQuality.duplicateTimestamps) block("DUPLICATE_TIMESTAMPS", "duplicate timestamps");
  if (dataQuality.outOfOrder) block("OUT_OF_ORDER", "out-of-order timestamps");
  if (dataQuality.malformedOHLC) block("MALFORMED_OHLC", "malformed OHLC");
  if (dataQuality.negativeVolume) block("NEGATIVE_VOLUME", "negative volume");
  for (const b of dataQuality.blockers) block(b, `data quality: ${b}`);
  if (!dataQuality.valid) block("BAD_DATA", "data quality invalid");

  // Regime.
  if (regime.regime === "MIXED") block("MIXED_REGIME", "market regime MIXED");
  if (regime.regime === "UNKNOWN") block("UNKNOWN_REGIME", "market regime UNKNOWN");
  if (regime.regime !== "RISK_ON" && regime.regime !== "RISK_OFF" && regime.regime !== "MIXED" && regime.regime !== "UNKNOWN") {
    block("UNKNOWN_REGIME", "unrecognized regime");
  }
  if (regime.aligned !== true) block("REGIME_NOT_ALIGNED", "SPX and MNQ are not aligned");
  for (const b of regime.blockers) block(b, `regime: ${b}`);

  // Consistency: the regime label must match what the directions imply (rejects fabricated states).
  const derived = regimeFromDirections(regime.spx, regime.mnq);
  if (derived.regime !== regime.regime && regime.regime !== "UNKNOWN") {
    block("INCONSISTENT_STATE", `regime ${regime.regime} does not follow from SPX ${regime.spx} / MNQ ${regime.mnq}`);
  }
  if (derived.aligned !== regime.aligned && regime.aligned) {
    block("INCONSISTENT_STATE", "alignment flag does not follow from directions");
  }

  // Unknown blocker codes are themselves a reason to block.
  for (const b of blockers) {
    if (!(BLOCKER_CODES as readonly string[]).includes(b)) block("BAD_DATA", `unrecognized blocker ${String(b)}`);
  }

  const finalBlockers = mergeUnique(blockers);
  const enabled = finalBlockers.length === 0 && (regime.regime === "RISK_ON" || regime.regime === "RISK_OFF") && regime.aligned === true && dataQuality.valid === true;

  return deepFreeze({
    permission: enabled ? "ENABLED" : "BLOCKED",
    reasons: enabled ? [`regime ${regime.regime} aligned; data quality valid`] : mergeUnique(reasons),
    blockers: enabled ? [] : finalBlockers.length > 0 ? finalBlockers : (["BAD_DATA"] as BlockerCode[]),
  });
}

export { ABSOLUTE_BLOCKER_CATEGORIES, BLOCKER_CATEGORY };
