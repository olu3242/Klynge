import { deepFreeze } from "../domain/freeze.ts";
import type { DataQualityState, TechnicalState, TradingSession } from "../domain/types.ts";
import { assessSessionQuality } from "../data-quality/series-quality.ts";
import { atr, ATR_PERIOD } from "../indicators/atr.ts";
import { ema, EMA9_PERIOD, emaSlope } from "../indicators/ema.ts";
import { relativeVolume, VOLUME_BASELINE_PERIOD } from "../indicators/volume.ts";
import { sessionVwap } from "../indicators/vwap.ts";
import type { DataQualityPolicy } from "../policies/data-quality-policy.ts";
import { confirmedStructure } from "../structure/structure.ts";

export interface TechnicalStateContext {
  now: number;
  policy?: DataQualityPolicy;
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
  const dataQuality = assessSessionQuality(session, ctx);
  if (!dataQuality.valid) return deepFreeze({ ok: false as const, dataQuality });

  const candles = session.candles;
  const last = candles[candles.length - 1];
  const closes = candles.map((c) => c.close);
  const ema9Series = ema(closes, EMA9_PERIOD);
  const ema9 = ema9Series[ema9Series.length - 1];
  const atr14 = atr(candles, ATR_PERIOD);
  const vwap = sessionVwap(session);
  const rv = relativeVolume(candles, VOLUME_BASELINE_PERIOD);

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
  };
  return deepFreeze({ ok: true as const, state, dataQuality });
}
