import { deepFreeze } from "../domain/freeze.ts";
import type { Candle, DataQualityState, TechnicalState, Timeframe, TradingSession } from "../domain/types.ts";
import { assessSessionQuality, dataQualityFailure, mergeDataQuality } from "../data-quality/series-quality.ts";
import { atr, ATR_PERIOD } from "../indicators/atr.ts";
import { ema, EMA9_PERIOD, emaSlope } from "../indicators/ema.ts";
import { relativeVolume, VOLUME_BASELINE_PERIOD } from "../indicators/volume.ts";
import { vwapSeries } from "../indicators/vwap.ts";
import type { DataQualityPolicy } from "../policies/data-quality-policy.ts";
import { confirmedStructure } from "../structure/structure.ts";

export interface TechnicalStateContext {
  now: number;
  policy?: DataQualityPolicy;
  /**
   * Optional VOLUME_PROXY session (e.g. SPY for SPX). Supplies volume ONLY: VWAP weights and relative
   * volume. Price, EMA, ATR, structure and direction always come from `session`. Must be bar-aligned.
   */
  volumeProxy?: TradingSession;
  /**
   * Completed prior sessions (ascending, same symbol/timeframe) used to warm up EMA, ATR, structure and
   * relative volume across sessions. VWAP still resets per session. Omitted => single-session behavior.
   */
  history?: readonly TradingSession[];
  /** Proxy sessions aligned 1:1 with `history` (required when both `history` and `volumeProxy` are set). */
  volumeProxyHistory?: readonly TradingSession[];
}

export type TechnicalStateResult =
  | { readonly ok: true; readonly state: Readonly<TechnicalState>; readonly dataQuality: Readonly<DataQualityState> }
  | { readonly ok: false; readonly dataQuality: Readonly<DataQualityState> };

function fail(dq: DataQualityState, reason: string): TechnicalStateResult {
  return deepFreeze({
    ok: false as const,
    dataQuality: { ...dq, valid: false, reasons: [...dq.reasons, reason], blockers: dq.blockers.includes("BAD_DATA") ? dq.blockers : [...dq.blockers, "BAD_DATA" as const] },
  });
}

export interface TechnicalAssemblyInput {
  symbol: string;
  timeframe: Timeframe;
  /** Full indicator series (history + current), ascending, validated. */
  candles: readonly Candle[];
  /** Current-session bars for VWAP (prices from the primary series, volume from the volume source). */
  vwapBars: readonly Pick<Candle, "high" | "low" | "close" | "volume">[];
  /** Volume series aligned with `candles` (primary or proxy) for relative volume. */
  volumeBars: readonly Pick<Candle, "volume">[];
  volumeSymbol?: string;
}

/** Shared, pure TechnicalState assembly from already-validated series. Single source for every timeframe. */
export function assembleTechnicalState(input: TechnicalAssemblyInput): { ok: true; state: TechnicalState } | { ok: false; reason: string } {
  const { candles } = input;
  const last = candles[candles.length - 1];
  const ema9Series = ema(
    candles.map((c) => c.close),
    EMA9_PERIOD,
  );
  const ema9 = ema9Series[ema9Series.length - 1];
  const atr14 = atr(candles, ATR_PERIOD);
  const vwap = vwapSeries(input.vwapBars, () => "session").at(-1) ?? null;
  const rv = relativeVolume(input.volumeBars, VOLUME_BASELINE_PERIOD);

  if (!last || ema9 === undefined || atr14 === null) return { ok: false, reason: "insufficient candles for indicators" };
  if (vwap === null) return { ok: false, reason: "session VWAP undefined (zero cumulative volume)" };
  if (rv === null) return { ok: false, reason: "volume baseline undefined (zero prior volume)" };

  return {
    ok: true,
    state: {
      symbol: input.symbol,
      timeframe: input.timeframe,
      timestamp: last.timestamp,
      price: last.close,
      vwap,
      ema9,
      ema9Slope: emaSlope(ema9Series),
      atr14,
      volume: rv.volume,
      averageVolume20: rv.averageVolume,
      volumeRatio: rv.ratio,
      structure: confirmedStructure(candles),
      ...(input.volumeSymbol !== undefined ? { volumeSymbol: input.volumeSymbol } : {}),
    },
  };
}

function aligned(a: TradingSession, b: TradingSession): boolean {
  return a.timeframe === b.timeframe && a.openTimestamp === b.openTimestamp && a.candles.length === b.candles.length && a.candles.every((c, i) => c.timestamp === b.candles[i]?.timestamp);
}

/** Validate prior sessions: same series, ascending, non-overlapping, complete, before the current session. */
export function assessSessionHistory(session: TradingSession, history: readonly TradingSession[], policy: DataQualityPolicy | undefined): DataQualityState[] {
  const out: DataQualityState[] = [];
  let prevClose = -Infinity;
  history.forEach((h, i) => {
    if (h.symbol !== session.symbol || h.timeframe !== session.timeframe) out.push(dataQualityFailure("MIXED_SERIES", `history[${i}] is not ${session.symbol} ${session.timeframe}`));
    if (h.openTimestamp < prevClose || h.closeTimestamp > session.openTimestamp) out.push(dataQualityFailure("OUT_OF_ORDER", `history[${i}] overlaps or follows the current session`));
    prevClose = h.closeTimestamp;
    const q = assessSessionQuality(h, policy === undefined ? { now: h.closeTimestamp } : { now: h.closeTimestamp, policy });
    const blockers = q.blockers.filter((b) => b !== "INSUFFICIENT_HISTORY");
    if (blockers.length) out.push({ ...q, sufficientHistory: true, valid: false, blockers, reasons: q.reasons.map((r) => `history[${i}]: ${r}`) });
  });
  return out;
}

/**
 * Build the deterministic technical state for one session (optionally warmed up by prior sessions).
 * Data quality is validated FIRST; nothing is computed from invalid input.
 */
export function buildTechnicalState(session: TradingSession, ctx: TechnicalStateContext): TechnicalStateResult {
  const proxy = ctx.volumeProxy;
  const history = ctx.history ?? [];
  const historyCandles = history.reduce((n, h) => n + h.candles.length, 0);
  const dqCtx = {
    now: ctx.now,
    ...(ctx.policy === undefined ? {} : { policy: ctx.policy }),
    ...(historyCandles > 0 ? { historyCandles } : {}),
  };
  const parts: DataQualityState[] = [assessSessionQuality(session, dqCtx), ...assessSessionHistory(session, history, ctx.policy)];
  const proxyHistory = ctx.volumeProxyHistory ?? [];
  if (proxy) {
    parts.push(assessSessionQuality(proxy, dqCtx));
    if (!aligned(proxy, session)) parts.push(dataQualityFailure("MIXED_SERIES", `volume proxy ${proxy.symbol} is not bar-aligned with ${session.symbol}`));
    if (history.length > 0) {
      const ok = proxyHistory.length === history.length && proxyHistory.every((p, i) => p.symbol === proxy.symbol && aligned(p, history[i] as TradingSession));
      if (!ok) parts.push(dataQualityFailure("MIXED_SERIES", `volume proxy history must align 1:1 with ${session.symbol} history`));
    }
  }
  const dataQuality = parts.length === 1 ? (parts[0] as DataQualityState) : mergeDataQuality(...parts);
  if (!dataQuality.valid) return deepFreeze({ ok: false as const, dataQuality });

  const candles = [...history.flatMap((h) => h.candles), ...session.candles];
  // Volume context: proxy volume (if permitted + supplied) weighted against the PRIMARY session's prices.
  const currentVolume = proxy ? proxy.candles : session.candles;
  const volumeBars = proxy ? [...proxyHistory.flatMap((h) => h.candles), ...proxy.candles] : candles;
  const vwapBars = session.candles.map((c, i) => ({ high: c.high, low: c.low, close: c.close, volume: (currentVolume[i] as Candle).volume }));
  const built = assembleTechnicalState({
    symbol: session.symbol,
    timeframe: session.timeframe,
    candles,
    vwapBars,
    volumeBars,
    ...(proxy ? { volumeSymbol: proxy.symbol } : {}),
  });
  if (!built.ok) return fail(dataQuality, built.reason);
  return deepFreeze({ ok: true as const, state: built.state, dataQuality });
}
