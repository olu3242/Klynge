/** Closed daily bar moving-average confluence; never uses a forming daily candle. */
import type { Candle } from "../domain/types.ts";
import { sma } from "./ema.ts";
export interface DailyConfluence {
  asOf: number;
  sma9: number;
  sma50: number;
  close: number;
  direction: "BULLISH" | "BEARISH" | "MIXED";
}
export function evaluateDailyConfluence(bars: readonly Candle[], evaluatedAt: number): DailyConfluence | undefined {
  if (!Number.isFinite(evaluatedAt)) throw new RangeError("Invalid evaluation time");
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!;
    if (b.timeframe !== "1d" || ![b.timestamp,b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite) ||
        b.low > Math.min(b.open,b.close) || b.high < Math.max(b.open,b.close) || b.volume < 0 ||
        (i > 0 && b.timestamp <= bars[i-1]!.timestamp))
      throw new RangeError("Invalid daily OHLCV history");
  }
  const closed = bars.filter(b=>b.timestamp+86400000<=evaluatedAt);
  if (closed.length < 50) return undefined;
  const values = closed.map(b=>b.close);
  const close = values[values.length-1]!;
  const sma9 = sma(values.slice(-9));
  const sma50 = sma(values.slice(-50));
  const direction = close > sma9 && close > sma50 ? "BULLISH" :
    close < sma9 && close < sma50 ? "BEARISH" : "MIXED";
  return {asOf:closed[closed.length-1]!.timestamp+86400000,sma9,sma50,close,direction};
}
