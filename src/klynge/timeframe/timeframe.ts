import type { Timeframe } from "../domain/types.ts";

const MINUTE = 60_000;

export const TIMEFRAMES: readonly Timeframe[] = Object.freeze(["1m", "5m", "15m", "30m", "1h", "4h", "1d"]);

export const TIMEFRAME_MS: Readonly<Record<Timeframe, number>> = Object.freeze({
  "1m": MINUTE,
  "5m": 5 * MINUTE,
  "15m": 15 * MINUTE,
  "30m": 30 * MINUTE,
  "1h": 60 * MINUTE,
  "4h": 240 * MINUTE,
  "1d": 1440 * MINUTE,
});

export function isTimeframe(value: unknown): value is Timeframe {
  return typeof value === "string" && Object.hasOwn(TIMEFRAME_MS, value);
}

export function timeframeToMs(timeframe: Timeframe): number {
  return TIMEFRAME_MS[timeframe];
}
