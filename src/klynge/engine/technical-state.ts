import { deepFreeze } from "../domain/freeze.ts";
import type { DataQualityState, TechnicalState, TradingSession } from "../domain/types.ts";
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

/**
 * Build the deterministic technical state for one session.
 * Data quality is validated FIRST; nothing is computed from invalid input.
 */
export function buildTechnicalState(session: TradingSession, ctx: TechnicalStateContext): TechnicalStateResult {
  const proxy = ctx.volumeProxy;
  const dqCtx = ctx.policy === undefined ? { now: ctx.now } : { now: ctx.now, policy: ctx.policy };
  let dataQuality = assessSessionQuality(session, dqCtx);
  if (proxy) {
    const aligned =
      proxy.timeframe === session.timeframe &&
      proxy.openTimestamp === session.openTimestamp &&
      proxy.candles.length === session.candles.length &&
      proxy.candles.every((c, i) => c.timestamp === session.candles[i]?.timestamp);
    dataQuality = mergeDataQuality(
      dataQuality,
      assessSessionQuality(proxy, dqCtx),
      ...(aligned ? [] : [dataQualityFailure("MIXED_SERIES", `volume proxy ${proxy.symbol} is not bar-aligned with ${session.symbol}`)]),
    );
  }
  if (!dataQuality.valid) return deepFreeze({ ok: false as const, dataQuality });

  const candles = session.candles;
  // Volume context: proxy volume (if permitted + supplied) weighted against the PRIMARY session's prices.
  const volumeBars = proxy ? proxy.candles : candles;
  const last = candles[candles.length - 1];
  const closes = candles.map((c) => c.close);
  const ema9Series = ema(closes, EMA9_PERIOD);
  const ema9 = ema9Series[ema9Series.length - 1];
  const atr14 = atr(candles, ATR_PERIOD);
  const vwapInput = candles.map((c, i) => ({ high: c.high, low: c.low, close: c.close, volume: (volumeBars[i] as { volume: number }).volume }));
  const vwap = vwapSeries(vwapInput, () => session.sessionId).at(-1) ?? null;
  const rv = relativeVolume(volumeBars, VOLUME_BASELINE_PERIOD);

  if (!last || ema9 === undefined || atr14 === null) return fail(dataQuality, "insufficient candles for indicators");
  if (vwap === null) return fail(dataQuality, "session VWAP undefined (zero cumulative volume)");
  if (rv === null) return fail(dataQuality, "volume baseline undefined (zero prior volume)");

  const state: TechnicalState = {
    symbol: session.symbol,
    timeframe: session.timeframe,
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
    ...(proxy ? { volumeSymbol: proxy.symbol } : {}),
  };
  return deepFreeze({ ok: true as const, state, dataQuality });
}
