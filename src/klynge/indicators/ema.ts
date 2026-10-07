import { assertFiniteSeries, assertPeriod } from "./assert.ts";

export const EMA9_PERIOD = 9;

export function sma(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError("sma requires at least one value");
  assertFiniteSeries(values);
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/**
 * Exponential moving average.
 * Seed = SMA of the first `period` values; multiplier = 2 / (period + 1).
 * Output[i] corresponds to input index `i + period - 1`. Fewer than `period` values => [].
 */
export function ema(values: readonly number[], period: number): number[] {
  assertPeriod(period);
  assertFiniteSeries(values);
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const out: number[] = [sma(values.slice(0, period))];
  for (let i = period; i < values.length; i++) {
    const prev = out[out.length - 1] as number;
    out.push((values[i] as number) * k + prev * (1 - k));
  }
  return out;
}

/** Slope of an EMA series: last value minus previous value (price units per bar). < 2 values => 0. */
export function emaSlope(emaValues: readonly number[]): number {
  if (emaValues.length < 2) return 0;
  assertFiniteSeries(emaValues, "emaValues");
  return (emaValues[emaValues.length - 1] as number) - (emaValues[emaValues.length - 2] as number);
}
