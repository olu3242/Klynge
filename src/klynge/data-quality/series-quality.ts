import { mergeUnique } from "../domain/blockers.ts";
import type { BlockerCode } from "../domain/blockers.ts";
import type { Candle, DataQualityState, Timeframe, TradingSession } from "../domain/types.ts";
import { assertValidPolicy, DEFAULT_DATA_QUALITY_POLICY, effectiveMinimumCandles } from "../policies/data-quality-policy.ts";
import type { DataQualityPolicy } from "../policies/data-quality-policy.ts";
import { isTimeframe, timeframeToMs } from "../timeframe/timeframe.ts";
import { validateCandle } from "./candle-validation.ts";

export interface DataQualityContext {
  /** Evaluation clock (epoch ms). Always explicit — never wall-clock. */
  now: number;
  policy?: DataQualityPolicy;
  /** If provided, every candle must match. */
  expectedSymbol?: string;
  expectedTimeframe?: Timeframe;
}

class Collector {
  readonly reasons: string[] = [];
  readonly blockers: BlockerCode[] = [];
  flag(blocker: BlockerCode, reason: string): void {
    if (!this.blockers.includes(blocker)) this.blockers.push(blocker);
    if (!this.reasons.includes(reason)) this.reasons.push(reason);
  }
}

function emptyState(): DataQualityState {
  return {
    valid: true,
    stale: false,
    missingCandles: false,
    timestampSkew: false,
    sufficientHistory: true,
    duplicateTimestamps: false,
    outOfOrder: false,
    malformedOHLC: false,
    negativeVolume: false,
    reasons: [],
    blockers: [],
  };
}

function finalize(state: DataQualityState, c: Collector): DataQualityState {
  state.reasons = mergeUnique(state.reasons, c.reasons);
  state.blockers = mergeUnique(state.blockers, c.blockers);
  state.valid = state.blockers.length === 0;
  return state;
}

/**
 * Deterministic validation of a candle series. Must run BEFORE any market analysis.
 * Engine contract: candles are CLOSED bars, ascending, unique, single symbol/timeframe.
 */
export function assessSeriesQuality(candles: readonly Candle[], ctx: DataQualityContext): DataQualityState {
  const policy = ctx.policy ?? DEFAULT_DATA_QUALITY_POLICY;
  assertValidPolicy(policy);
  const state = emptyState();
  const c = new Collector();

  if (!Number.isFinite(ctx.now)) {
    c.flag("BAD_DATA", "evaluation clock `now` is not finite");
  }

  if (candles.length === 0) {
    state.sufficientHistory = false;
    c.flag("NO_DATA", "no candles provided");
    c.flag("INSUFFICIENT_HISTORY", "0 candles available");
    return finalize(state, c);
  }

  // 1. Per-candle validation.
  candles.forEach((candle, i) => {
    for (const issue of validateCandle(candle)) {
      if (issue.blocker === "MALFORMED_OHLC") state.malformedOHLC = true;
      if (issue.blocker === "NEGATIVE_VOLUME") state.negativeVolume = true;
      c.flag(issue.blocker, `candle[${i}]: ${issue.message}`);
    }
  });

  // 2. Series homogeneity.
  const first = candles[0] as Candle;
  const symbol = ctx.expectedSymbol ?? first.symbol;
  const timeframe = ctx.expectedTimeframe ?? first.timeframe;
  if (candles.some((k) => k.symbol !== symbol)) c.flag("MIXED_SERIES", `series contains symbols other than "${symbol}"`);
  if (candles.some((k) => k.timeframe !== timeframe)) c.flag("MIXED_SERIES", `series contains timeframes other than "${timeframe}"`);

  // 3. Ordering / uniqueness / continuity.
  const tfMs = isTimeframe(timeframe) ? timeframeToMs(timeframe) : NaN;
  for (let i = 1; i < candles.length; i++) {
    const prev = (candles[i - 1] as Candle).timestamp;
    const cur = (candles[i] as Candle).timestamp;
    if (cur === prev) {
      state.duplicateTimestamps = true;
      c.flag("DUPLICATE_TIMESTAMPS", `duplicate timestamp ${cur} at index ${i}`);
    } else if (cur < prev) {
      state.outOfOrder = true;
      c.flag("OUT_OF_ORDER", `timestamp at index ${i} precedes index ${i - 1}`);
    } else if (Number.isFinite(tfMs)) {
      const delta = cur - prev;
      if (delta % tfMs !== 0) {
        c.flag("BAD_DATA", `index ${i} is not aligned to the ${timeframe} interval`);
      } else if (delta > tfMs) {
        state.missingCandles = true;
        c.flag("MISSING_CANDLES", `${delta / tfMs - 1} missing candle(s) before index ${i}`);
      }
    }
  }

  // 4. History.
  const required = effectiveMinimumCandles(policy);
  if (candles.length < required) {
    state.sufficientHistory = false;
    c.flag("INSUFFICIENT_HISTORY", `${candles.length} candles available, ${required} required`);
  }

  // 5. Closed-candle (no-lookahead) and staleness against the explicit clock.
  const last = candles[candles.length - 1] as Candle;
  if (Number.isFinite(tfMs) && Number.isFinite(ctx.now) && Number.isSafeInteger(last.timestamp)) {
    const futureBars = candles.filter((k) => k.timestamp + tfMs > ctx.now).length;
    if (futureBars > 0) {
      c.flag("INCOMPLETE_CANDLE", `${futureBars} candle(s) not closed at evaluation time`);
    }
    const lastClose = last.timestamp + tfMs;
    if (ctx.now - lastClose > tfMs + policy.maxStalenessMs) {
      state.stale = true;
      c.flag("STALE_DATA", `last candle closed ${ctx.now - lastClose}ms before evaluation`);
    }
  }

  return finalize(state, c);
}

/** Series checks plus session-boundary checks (leading gap, candles outside session, alignment). */
export function assessSessionQuality(session: TradingSession, ctx: Omit<DataQualityContext, "expectedSymbol" | "expectedTimeframe">): DataQualityState {
  const state = assessSeriesQuality(session.candles, { ...ctx, expectedSymbol: session.symbol, expectedTimeframe: session.timeframe });
  const c = new Collector();
  const { openTimestamp: open, closeTimestamp: close } = session;

  if (!Number.isSafeInteger(open) || !Number.isSafeInteger(close) || close <= open) {
    c.flag("BAD_DATA", "session boundaries are invalid");
    return finalize(state, c);
  }
  if (!isTimeframe(session.timeframe)) {
    c.flag("BAD_DATA", "session timeframe is invalid");
    return finalize(state, c);
  }
  const tfMs = timeframeToMs(session.timeframe);
  session.candles.forEach((k, i) => {
    if (k.timestamp < open || k.timestamp >= close) c.flag("BAD_DATA", `candle[${i}] is outside session ${session.sessionId}`);
    else if ((k.timestamp - open) % tfMs !== 0) c.flag("BAD_DATA", `candle[${i}] is not aligned to session open`);
  });
  const first = session.candles[0];
  if (first && first.timestamp > open && (first.timestamp - open) % tfMs === 0) {
    state.missingCandles = true;
    c.flag("MISSING_CANDLES", `${(first.timestamp - open) / tfMs} missing candle(s) at session open`);
  }
  return finalize(state, c);
}

export interface SnapshotTimestamp {
  label: string;
  timestamp: number;
}

/** Cross-instrument synchronization check (e.g. SPX vs MNQ snapshot). */
export function assessSnapshotSync(snapshots: readonly SnapshotTimestamp[], policy: DataQualityPolicy = DEFAULT_DATA_QUALITY_POLICY): DataQualityState {
  assertValidPolicy(policy);
  const state = emptyState();
  const c = new Collector();
  if (snapshots.length === 0 || snapshots.some((s) => !Number.isFinite(s.timestamp))) {
    c.flag("NO_DATA", "snapshot timestamps unavailable");
    state.sufficientHistory = false;
    return finalize(state, c);
  }
  const ts = snapshots.map((s) => s.timestamp);
  const skew = Math.max(...ts) - Math.min(...ts);
  if (skew > policy.maxMarketSnapshotSkewMs) {
    state.timestampSkew = true;
    c.flag("TIMESTAMP_SKEW", `snapshot skew ${skew}ms across ${snapshots.map((s) => s.label).join("/")} exceeds policy`);
  }
  return finalize(state, c);
}

/** Combine states: any failure anywhere fails the whole. Order-preserving and deterministic. */
export function mergeDataQuality(...states: readonly DataQualityState[]): DataQualityState {
  if (states.length === 0) {
    return assessSeriesQuality([], { now: 0 });
  }
  const blockers = mergeUnique(...states.map((s) => s.blockers));
  return {
    valid: blockers.length === 0 && states.every((s) => s.valid),
    stale: states.some((s) => s.stale),
    missingCandles: states.some((s) => s.missingCandles),
    timestampSkew: states.some((s) => s.timestampSkew),
    sufficientHistory: states.every((s) => s.sufficientHistory),
    duplicateTimestamps: states.some((s) => s.duplicateTimestamps),
    outOfOrder: states.some((s) => s.outOfOrder),
    malformedOHLC: states.some((s) => s.malformedOHLC),
    negativeVolume: states.some((s) => s.negativeVolume),
    reasons: mergeUnique(...states.map((s) => s.reasons)),
    blockers,
  };
}
