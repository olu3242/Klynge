import type { Candle, MarketStructure, SwingPoint } from "../domain/types.ts";
import { DEFAULT_SWING_LOOKBACK, findSwingPoints } from "./swings.ts";

/**
 * Compare the last two confirmed swing highs and the last two confirmed swing lows.
 * HH + HL => HH_HL; LH + LL => LH_LL; anything else (incl. equal or insufficient swings) => MIXED.
 */
export function classifyStructure(swings: readonly SwingPoint[]): MarketStructure {
  const highs = swings.filter((s) => s.type === "HIGH");
  const lows = swings.filter((s) => s.type === "LOW");
  if (highs.length < 2 || lows.length < 2) return "MIXED";
  const [h1, h2] = highs.slice(-2) as [SwingPoint, SwingPoint];
  const [l1, l2] = lows.slice(-2) as [SwingPoint, SwingPoint];
  if (h2.price > h1.price && l2.price > l1.price) return "HH_HL";
  if (h2.price < h1.price && l2.price < l1.price) return "LH_LL";
  return "MIXED";
}

export function confirmedStructure(bars: readonly Pick<Candle, "timestamp" | "high" | "low">[], lookback: number = DEFAULT_SWING_LOOKBACK): MarketStructure {
  return classifyStructure(findSwingPoints(bars, lookback));
}
