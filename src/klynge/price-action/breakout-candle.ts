/** Closed-bar breakout candle confirmation. Candidate evidence only; NEVER order placement or trade certification. */
import type { Candle, Direction } from "../domain/types.ts";

export type BreakoutCandleSide = "CALL" | "PUT";
export interface BreakoutCandleInput {
  /** Last three completed 5m bars: standout candle, breakout, retest. */
  candles: readonly Candle[];
  direction: BreakoutCandleSide;
  /** Verified session VWAP and 5m EMA9 at the last completed bar. */
  vwap?: number;
  ema9?: number;
  /** Verified typical volume of comparable completed 5m bars (not current volume). */
  averageVolume?: number;
  spx?: Direction;
  mnq?: Direction;
  /** SPX/MNQ five-minute regime evidence as-of timestamps. */
  spxEvaluatedAt?: number;
  mnqEvaluatedAt?: number;
  /** Confirmed structural target already known at evaluation time. */
  target?: number;
  targetKnownAt?: number;
  evaluatedAt: number;
  minimumRewardRisk?: number;
  bodyThreshold?: number;
  wickRatio?: number;
  volumeMultiplier?: number;
  /** Fraction of candle range permitted around the standout high/low on retest. */
  retestToleranceRatio?: number;
}
export interface BreakoutCandleDecision {
  state: "BLOCKED" | "WAIT" | "CANDIDATE";
  direction: BreakoutCandleSide;
  reasons: readonly string[];
  entry?: number;
  stop?: number;
  target?: number;
  rewardRisk?: number;
  /** CANDIDATE is NEVER certified, permission to trade, or permission to alert. */
}
const validPositive = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v) && v > 0;
const blocked = (direction: BreakoutCandleSide, reason: string): BreakoutCandleDecision =>
  ({ state: "BLOCKED", direction, reasons: [reason] });
const wait = (direction: BreakoutCandleSide, reason: string): BreakoutCandleDecision =>
  ({ state: "WAIT", direction, reasons: [reason] });

export function evaluateBreakoutCandle(input: BreakoutCandleInput): BreakoutCandleDecision {
  const side = input.direction;
  if (side !== "CALL" && side !== "PUT") return blocked(side, "Invalid direction");
  const bodyThreshold = input.bodyThreshold ?? 0.6;
  const wickRatio = input.wickRatio ?? 2;
  const volumeMultiplier = input.volumeMultiplier ?? 1.2;
  const minimumRR = input.minimumRewardRisk ?? 2;
  const tolerance = input.retestToleranceRatio ?? 0.1;
  if (![bodyThreshold, wickRatio, volumeMultiplier, minimumRR, tolerance].every(Number.isFinite) ||
      bodyThreshold <= 0 || bodyThreshold > 1 || wickRatio <= 0 || volumeMultiplier < 1 ||
      minimumRR < 2 || tolerance < 0 || tolerance > 0.5)
    return blocked(side, "Invalid or permissive risk and candle parameters");
  if (input.candles.length < 3 || !Number.isFinite(input.evaluatedAt))
    return blocked(side, "Three completed 5m candles and valid evaluation time required");
  const bars = input.candles;
  const symbol = bars[0]!.symbol;
  if (!symbol) return blocked(side, "Missing symbol");
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!;
    if (b.symbol !== symbol || b.timeframe !== "5m" ||
        ![b.timestamp, b.open, b.high, b.low, b.close, b.volume].every(Number.isFinite) ||
        b.open <= 0 || b.low <= 0 || b.high < b.low || b.volume <= 0 ||
        b.low > Math.min(b.open,b.close) || b.high < Math.max(b.open,b.close) ||
        b.timestamp + 300000 > input.evaluatedAt ||
        (i > 0 && b.timestamp !== bars[i-1]!.timestamp + 300000))
      return blocked(side, "Invalid, unfinished, mixed, or nonconsecutive 5m OHLCV");
  }
  if (!validPositive(input.vwap) || !validPositive(input.ema9) ||
      !validPositive(input.averageVolume) || !validPositive(input.target) ||
      !Number.isFinite(input.targetKnownAt) || input.targetKnownAt! > bars[bars.length - 3]!.timestamp)
    return blocked(side, "Verified VWAP, EMA9, volume baseline and pre-known target required");
  const lastCloseAt = bars[bars.length - 1]!.timestamp + 300000;
  if (!Number.isFinite(input.spxEvaluatedAt) || !Number.isFinite(input.mnqEvaluatedAt) ||
      input.spxEvaluatedAt! < lastCloseAt - 300000 || input.spxEvaluatedAt! > input.evaluatedAt ||
      input.mnqEvaluatedAt! < lastCloseAt - 300000 || input.mnqEvaluatedAt! > input.evaluatedAt ||
      Math.abs(input.spxEvaluatedAt! - input.mnqEvaluatedAt!) > 300000)
    return blocked(side, "Missing, stale, or unsynchronized SPX/MNQ five-minute evidence");
  const regime = side === "CALL" ? "BULLISH" : "BEARISH";
  if (input.spx !== regime || input.mnq !== regime)
    return blocked(side, "Synchronized SPX/MNQ directional confirmation missing");
  const setup = bars[bars.length - 3]!, breakout = bars[bars.length - 2]!, retest = bars[bars.length - 1]!;
  const range = setup.high - setup.low;
  if (range <= 0) return wait(side, "Standout candle has no range");
  const body = Math.abs(setup.close - setup.open);
  const bodyRatio = body / range;
  const lowerWick = Math.min(setup.open, setup.close) - setup.low;
  const upperWick = setup.high - Math.max(setup.open, setup.close);
  const bull = side === "CALL";
  const strongBody = bull
    ? setup.close > setup.open && bodyRatio >= bodyThreshold && setup.close >= setup.low + 0.75 * range
    : setup.close < setup.open && bodyRatio >= bodyThreshold && setup.close <= setup.high - 0.75 * range;
  const rejection = bull
    ? lowerWick >= wickRatio * Math.max(body, range * 0.05) && upperWick <= range * 0.2 && setup.close >= setup.low + 0.6 * range
    : upperWick >= wickRatio * Math.max(body, range * 0.05) && lowerWick <= range * 0.2 && setup.close <= setup.high - 0.6 * range;
  if (!strongBody && !rejection) return wait(side, "No directionally valid standout candle");
  const level = bull ? setup.high : setup.low;
  if (bull ? breakout.close <= level : breakout.close >= level)
    return wait(side, "Completed breakout candle did not close beyond standout extreme");
  if (breakout.volume < input.averageVolume * volumeMultiplier)
    return wait(side, "Breakout candle relative volume below threshold");
  const buffer = range * tolerance;
  const retestValid = bull
    ? retest.low <= level + buffer && retest.close > level && retest.close > retest.open
    : retest.high >= level - buffer && retest.close < level && retest.close < retest.open;
  if (!retestValid) return wait(side, "Completed retest/rejection confirmation absent");
  if (bull ? retest.close <= input.vwap || retest.close <= input.ema9
           : retest.close >= input.vwap || retest.close >= input.ema9)
    return wait(side, "VWAP/EMA9 alignment absent on retest close");
  const entry = retest.close;
  const stop = bull ? setup.low : setup.high;
  const target = input.target;
  const risk = bull ? entry - stop : stop - entry;
  const reward = bull ? target - entry : entry - target;
  if (risk <= 0 || reward <= 0) return blocked(side, "Invalid structural stop/target direction");
  const rewardRisk = reward / risk;
  if (rewardRisk < minimumRR) return wait(side, "Confirmed structural target does not provide minimum 2:1 reward-to-risk");
  return { state: "CANDIDATE", direction: side,
    reasons: ["Completed breakout and retest with relative volume, VWAP/EMA9, and regime alignment; downstream data quality, spread, options and execution certification still required"],
    entry, stop, target, rewardRisk };
}
