/**
 * Canonical blocker codes. Every BLOCKED outcome must cite at least one.
 * Granular codes roll up into the absolute-invariant categories.
 */
export const BLOCKER_CODES = [
  "NO_DATA",
  "STALE_DATA",
  "BAD_DATA",
  "MALFORMED_OHLC",
  "NEGATIVE_VOLUME",
  "DUPLICATE_TIMESTAMPS",
  "OUT_OF_ORDER",
  "MIXED_SERIES",
  "MISSING_CANDLES",
  "INCOMPLETE_CANDLE",
  "INCONSISTENT_STATE",
  "TIMESTAMP_SKEW",
  "INSUFFICIENT_HISTORY",
  "MIXED_REGIME",
  "UNKNOWN_REGIME",
  "REGIME_NOT_ALIGNED",
] as const;

export type BlockerCode = (typeof BLOCKER_CODES)[number];

/** Absolute invariant categories: any of these => BLOCKED, never downstream directional eligibility. */
export const ABSOLUTE_BLOCKER_CATEGORIES = [
  "NO_DATA",
  "STALE_DATA",
  "BAD_DATA",
  "TIMESTAMP_SKEW",
  "INSUFFICIENT_HISTORY",
  "MIXED_REGIME",
  "UNKNOWN_REGIME",
] as const;

export type AbsoluteBlockerCategory = (typeof ABSOLUTE_BLOCKER_CATEGORIES)[number];

export const BLOCKER_CATEGORY: Readonly<Record<BlockerCode, AbsoluteBlockerCategory>> = Object.freeze({
  NO_DATA: "NO_DATA",
  STALE_DATA: "STALE_DATA",
  BAD_DATA: "BAD_DATA",
  MALFORMED_OHLC: "BAD_DATA",
  NEGATIVE_VOLUME: "BAD_DATA",
  DUPLICATE_TIMESTAMPS: "BAD_DATA",
  OUT_OF_ORDER: "BAD_DATA",
  MIXED_SERIES: "BAD_DATA",
  MISSING_CANDLES: "BAD_DATA",
  INCOMPLETE_CANDLE: "BAD_DATA",
  INCONSISTENT_STATE: "BAD_DATA",
  TIMESTAMP_SKEW: "TIMESTAMP_SKEW",
  INSUFFICIENT_HISTORY: "INSUFFICIENT_HISTORY",
  MIXED_REGIME: "MIXED_REGIME",
  UNKNOWN_REGIME: "UNKNOWN_REGIME",
  REGIME_NOT_ALIGNED: "MIXED_REGIME",
});

/** Stable, de-duplicated merge that preserves first-seen order (determinism). */
export function mergeUnique<T>(...lists: readonly (readonly T[])[]): T[] {
  const out: T[] = [];
  const seen = new Set<T>();
  for (const list of lists) {
    for (const item of list) {
      if (!seen.has(item)) {
        seen.add(item);
        out.push(item);
      }
    }
  }
  return out;
}
