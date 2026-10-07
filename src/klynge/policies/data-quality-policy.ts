export interface DataQualityPolicy {
  /**
   * Grace period after the NEXT candle was due. Engine evaluates closed candles only, so the
   * series is stale when `now - lastCandleClose > timeframeMs + maxStalenessMs`.
   */
  maxStalenessMs: number;
  /** Max allowed |spx.timestamp - mnq.timestamp| before the regime is UNKNOWN. */
  maxMarketSnapshotSkewMs: number;
  /** Raised to TECHNICAL_REQUIRED_CANDLES if configured lower; indicators cannot run on less. */
  minimumTechnicalCandles: number;
}

/**
 * Hard floor: ATR14 needs 15 candles (14 true ranges), relative volume needs 20 prior bars + current.
 */
export const TECHNICAL_REQUIRED_CANDLES = 21;

export const DEFAULT_DATA_QUALITY_POLICY: Readonly<DataQualityPolicy> = Object.freeze({
  maxStalenessMs: 60_000,
  maxMarketSnapshotSkewMs: 60_000,
  minimumTechnicalCandles: TECHNICAL_REQUIRED_CANDLES,
});

export function effectiveMinimumCandles(policy: DataQualityPolicy): number {
  return Math.max(TECHNICAL_REQUIRED_CANDLES, policy.minimumTechnicalCandles);
}

export function assertValidPolicy(policy: DataQualityPolicy): void {
  const fields: (keyof DataQualityPolicy)[] = ["maxStalenessMs", "maxMarketSnapshotSkewMs", "minimumTechnicalCandles"];
  for (const field of fields) {
    const v = policy[field];
    if (!Number.isFinite(v) || v < 0) {
      throw new RangeError(`DataQualityPolicy.${field} must be a finite, non-negative number`);
    }
  }
}
