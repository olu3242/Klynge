import type { Candle } from "../domain/types.ts";
import { runPriceAction } from "./state-machine.ts";
import type { PriceActionPolicy, SetupSide } from "./types.ts";

/** Binary-exact policy (ATR = 1, level = 100) so boundary tests are exact. */
export const P: PriceActionPolicy = {
  break: { minimumCloseDistanceAtr: 0.5 },
  acceptance: { requiredCloses: 2, maximumFailureDistanceAtr: 0.25 },
  retest: { toleranceAtr: 0.25, maximumDepthAtr: 0.5 },
  touchToleranceAtr: 0.25,
  invalidationToleranceAtr: 0.25,
};

export type OHLC = [number, number, number, number];

/** Mirror around the level (100) so bearish tests reuse bullish bars. */
export const mirror = (bars: OHLC[]): OHLC[] => bars.map(([o, h, l, c]) => [200 - o, 200 - l, 200 - h, 200 - c]);

export function run(bars: OHLC[], side: SetupSide = "BULLISH", policy: PriceActionPolicy = P, canStart?: (i: number) => boolean) {
  const candles: Candle[] = bars.map(([o, h, l, c], i) => ({ symbol: "X", timeframe: "5m", timestamp: 1000 + i, open: o, high: h, low: l, close: c, volume: 1 }));
  return runPriceAction({
    candles,
    level: { id: "L", price: 100 },
    side,
    startIndex: 0,
    atrAt: candles.map(() => 1),
    policy,
    ...(canStart ? { canStartLifecycle: canStart } : {}),
  });
}

// Building blocks (bullish, level 100, ATR 1).
export const BELOW: OHLC = [99, 99.25, 98.75, 99];
export const WICK_ABOVE: OHLC = [99.5, 101, 99.25, 99.75]; // wick through, close below
export const BREAK: OHLC = [99.75, 100.75, 99.5, 100.5]; // close exactly at 100 + 0.5 ATR
export const ABOVE: OHLC = [100.5, 101, 100.5, 100.75];
export const RETEST: OHLC = [100.75, 100.75, 100.25, 100.5]; // low at exactly level + tolerance
export const CONTINUATION: OHLC = [100.5, 101.25, 100.5, 101];
