import type { Candle } from "../domain/types.ts";
import { assertPeriod } from "./assert.ts";
import { sma } from "./ema.ts";

export const ATR_PERIOD = 14;

type Bar = Pick<Candle, "high" | "low" | "close">;

/** max(high - low, |high - prevClose|, |low - prevClose|) */
export function trueRange(bar: Bar, prevClose: number): number {
  return Math.max(bar.high - bar.low, Math.abs(bar.high - prevClose), Math.abs(bar.low - prevClose));
}

/** True ranges for every bar that has a previous close. Output[i] corresponds to input index i + 1. */
export function trueRanges(bars: readonly Bar[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    out.push(trueRange(bars[i] as Bar, (bars[i - 1] as Bar).close));
  }
  return out;
}

/**
 * Canonical Klynge ATR: SIMPLE average of the most recent `period` true ranges.
 * Deliberately NOT Wilder smoothing. Requires period + 1 bars; otherwise null.
 */
export function atr(bars: readonly Bar[], period: number = ATR_PERIOD): number | null {
  assertPeriod(period);
  const tr = trueRanges(bars);
  if (tr.length < period) return null;
  return sma(tr.slice(-period));
}

/** ATR as known at each bar (no lookahead): out[i] = atr(bars[0..i]) or null while insufficient. */
export function atrSeries(bars: readonly Bar[], period: number = ATR_PERIOD): (number | null)[] {
  assertPeriod(period);
  const tr = trueRanges(bars);
  return bars.map((_, i) => (i < period ? null : sma(tr.slice(i - period, i))));
}
