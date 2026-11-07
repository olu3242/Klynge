/** Klynge bidirectional historical reversal contracts (Issue #3).
 * This module is additive; existing breakout/retest logic remains unchanged.
 * These are candidate classifications, NEVER certified trade permissions.
 */
import type { Candle, Direction } from "../domain/types.ts";

export type HistoricalReversalStrategy = "K-HD-C" | "K-HR-P";
export type HistoricalReversalState = "WAIT" | "CANDIDATE" | "BLOCKED";
export interface HistoricalReversalInput {
  strategy: HistoricalReversalStrategy;
  /** Closed five-minute bars in ascending order; no in-progress candle. */
  candles: readonly Candle[];
  /** Historical level already known before the first evaluation candle. */
  level: number;
  levelKnownAt: number;
  /** Daily SMA9/SMA50 computed from completed daily bars only. */
  dailySma9?: number;
  dailySma50?: number;
  /** Current session VWAP and 5m EMA9 from verified data. */
  vwap?: number;
  ema9?: number;
  spx?: Direction;
  mnq?: Direction;
  /** Evaluation instant, after the last bar has completed. */
  evaluatedAt: number;
}
export interface HistoricalReversalResult {
  strategy: HistoricalReversalStrategy;
  state: HistoricalReversalState;
  direction: "BULLISH" | "BEARISH";
  reasons: readonly string[];
}
/** Conservative observation gate: rejection candidates require a sweep and close back across a known level.
 * Confirmation, risk and options eligibility MUST be evaluated downstream.
 */
export function evaluateHistoricalReversal(input: HistoricalReversalInput): HistoricalReversalResult {
  const direction = input.strategy === "K-HD-C" ? "BULLISH" : "BEARISH";
  const blocked = (reason: string): HistoricalReversalResult => ({ strategy: input.strategy, direction, state: "BLOCKED", reasons: [reason] });
  if (!Number.isFinite(input.level) || input.level <= 0 || !Number.isFinite(input.levelKnownAt) || !Number.isFinite(input.evaluatedAt))
    return blocked("Invalid historical level or timestamps");
  if (input.candles.length < 2) return blocked("At least two completed five-minute bars required");
  const bars = input.candles;
  for (let i = 0; i < bars.length; i++) {
    const b = (bars[i] as Candle);
    if (b.timeframe !== "5m" || ![b.open,b.high,b.low,b.close,b.volume,b.timestamp].every(Number.isFinite) ||
        b.low > Math.min(b.open,b.close) || b.high < Math.max(b.open,b.close) || b.volume < 0 ||
        b.timestamp + 300000 > input.evaluatedAt || (i > 0 && b.timestamp <= (bars[i-1] as Candle).timestamp))
      return blocked("Invalid, unfinished, or unordered five-minute OHLCV");
  }
  if (input.levelKnownAt > (bars[0] as Candle).timestamp) return blocked("Historical level was not known at evaluation start");
  if (![input.dailySma9,input.dailySma50,input.vwap,input.ema9].every(v => v !== undefined && Number.isFinite(v) && v > 0))
    return blocked("Verified SMA9, SMA50, VWAP and EMA9 required");
  if (!input.spx || !input.mnq || input.spx !== direction || input.mnq !== direction)
    return blocked("SPX/MNQ regime not aligned or missing");
  const sweep = (bars[bars.length - 2] as Candle);
  const follow = (bars[bars.length - 1] as Candle);
  const defended = direction === "BULLISH"
    ? sweep.low < input.level && sweep.close > input.level && follow.close > input.level && follow.close > follow.open
    : sweep.high > input.level && sweep.close < input.level && follow.close < input.level && follow.close < follow.open;
  if (!defended) return { strategy: input.strategy, direction, state: "WAIT", reasons: ["Historical sweep and continuation not observed"] };
  const momentum = direction === "BULLISH"
    ? follow.close > (input.vwap as number) && follow.close > (input.ema9 as number)
    : follow.close < (input.vwap as number) && follow.close < (input.ema9 as number);
  if (!momentum) return { strategy: input.strategy, direction, state: "WAIT", reasons: ["VWAP/EMA9 continuation missing"] };
  return { strategy: input.strategy, direction, state: "CANDIDATE", reasons: ["Historical sweep and continuation observed; risk, retest, volume and trade certification still required"] };
}
