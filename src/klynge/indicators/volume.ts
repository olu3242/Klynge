import type { Candle, VolumeClass } from "../domain/types.ts";
import { assertPeriod } from "./assert.ts";
import { sma } from "./ema.ts";

export const VOLUME_BASELINE_PERIOD = 20;

export const VOLUME_THRESHOLDS = Object.freeze({ STRONG: 1.5, CONFIRMING: 1.2, NORMAL: 0.8 });

export interface RelativeVolume {
  volume: number;
  /** Average of the `period` bars BEFORE the current bar (current bar excluded). */
  averageVolume: number;
  ratio: number;
}

/** Requires period + 1 bars and a non-zero baseline; otherwise null. */
export function relativeVolume(bars: readonly Pick<Candle, "volume">[], period: number = VOLUME_BASELINE_PERIOD): RelativeVolume | null {
  assertPeriod(period);
  if (bars.length < period + 1) return null;
  const current = bars[bars.length - 1] as Pick<Candle, "volume">;
  const baseline = sma(bars.slice(-(period + 1), -1).map((b) => b.volume));
  if (baseline <= 0) return null;
  return { volume: current.volume, averageVolume: baseline, ratio: current.volume / baseline };
}

export function classifyVolume(ratio: number): VolumeClass {
  if (ratio >= VOLUME_THRESHOLDS.STRONG) return "STRONG";
  if (ratio >= VOLUME_THRESHOLDS.CONFIRMING) return "CONFIRMING";
  if (ratio >= VOLUME_THRESHOLDS.NORMAL) return "NORMAL";
  return "WEAK";
}
