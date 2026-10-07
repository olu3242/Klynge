import type { Candle, TradingSession } from "../domain/types.ts";

type Bar = Pick<Candle, "high" | "low" | "close" | "volume">;

export function typicalPrice(bar: Bar): number {
  return (bar.high + bar.low + bar.close) / 3;
}

/**
 * Cumulative VWAP series that RESETS whenever `sessionKey` changes.
 * Entry is null while cumulative session volume is zero (VWAP undefined).
 */
export function vwapSeries<T extends Bar>(bars: readonly T[], sessionKey: (bar: T, index: number) => string): (number | null)[] {
  const out: (number | null)[] = [];
  let key: string | undefined;
  let pv = 0;
  let vol = 0;
  bars.forEach((bar, i) => {
    const k = sessionKey(bar, i);
    if (k !== key) {
      key = k;
      pv = 0;
      vol = 0;
    }
    pv += typicalPrice(bar) * bar.volume;
    vol += bar.volume;
    out.push(vol > 0 ? pv / vol : null);
  });
  return out;
}

/** Session VWAP = Σ(typical × volume) / Σ volume over the session's candles. null if undefined. */
export function sessionVwap(session: Pick<TradingSession, "sessionId" | "candles">): number | null {
  const series = vwapSeries(session.candles, () => session.sessionId);
  return series.length === 0 ? null : (series[series.length - 1] ?? null);
}
