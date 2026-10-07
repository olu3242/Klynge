import type { Candle, SwingPoint } from "../domain/types.ts";

export const DEFAULT_SWING_LOOKBACK = 2;

type Bar = Pick<Candle, "timestamp" | "high" | "low">;

/**
 * Confirmed swing points. A swing at index i requires `lookback` bars on BOTH sides, so it is
 * only known at index i + lookback (recorded as confirmedAtIndex/confirmedAtTimestamp).
 * High: strictly greater than every high in both windows. Low: strictly lower than every low.
 * Output is ordered by index; HIGH precedes LOW on the same bar.
 */
export function findSwingPoints(bars: readonly Bar[], lookback: number = DEFAULT_SWING_LOOKBACK): SwingPoint[] {
  if (!Number.isSafeInteger(lookback) || lookback < 1) throw new RangeError("lookback must be a positive integer");
  const out: SwingPoint[] = [];
  for (let i = lookback; i < bars.length - lookback; i++) {
    const bar = bars[i] as Bar;
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      const other = bars[j] as Bar;
      if (!(bar.high > other.high)) isHigh = false;
      if (!(bar.low < other.low)) isLow = false;
    }
    const confirmedAtIndex = i + lookback;
    const confirmedAtTimestamp = (bars[confirmedAtIndex] as Bar).timestamp;
    if (isHigh) out.push({ index: i, timestamp: bar.timestamp, price: bar.high, type: "HIGH", confirmedAtIndex, confirmedAtTimestamp });
    if (isLow) out.push({ index: i, timestamp: bar.timestamp, price: bar.low, type: "LOW", confirmedAtIndex, confirmedAtTimestamp });
  }
  return out;
}

/** Swings knowable at bar `asOfIndex` (no lookahead). */
export function swingsKnownAt(swings: readonly SwingPoint[], asOfIndex: number): SwingPoint[] {
  return swings.filter((s) => s.confirmedAtIndex <= asOfIndex);
}
