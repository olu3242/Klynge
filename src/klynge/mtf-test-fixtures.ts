/**
 * Multi-day, multi-timeframe fixtures. Sessions are 7h (28 × 15m = 84 × 5m) so every role divides evenly.
 * 15m paths are generated first, then expanded deterministically into 5m bars (base feed).
 */
import type { Candle, TradingSession } from "./domain/types.ts";
import { BULL_BARS, mirrorBars } from "./setup-test-fixtures.ts";
import { T0 } from "./test-fixtures.ts";

export type Bar = [number, number, number, number];
export const DAY = 24 * 60 * 60_000;
export const SESSION_MS = 7 * 60 * 60_000;
export const M5 = 5 * 60_000;
export const M15 = 15 * 60_000;
export const HISTORY_DAYS = 24;

export const dayOpen = (d: number) => T0 - (HISTORY_DAYS - d) * DAY; // d = HISTORY_DAYS is the current day

/** Expand a 15m bar into three 5m bars whose aggregate is exactly the 15m bar (trend-consistent path). */
export function expand([o, h, l, c]: Bar): Bar[] {
  if (c >= o) {
    const m = (l + c) / 2;
    return [[o, o, l, l], [l, m, l, m], [m, h, m, c]];
  }
  const m = (h + c) / 2;
  return [[o, h, o, h], [h, h, m, m], [m, m, l, c]];
}

const tri = (i: number, period: number) => {
  const p = ((i % period) + period) % period;
  const half = period / 2;
  return p <= half ? -1 + (2 * p) / half : 1 - (2 * (p - half)) / half;
};

/** 15m bars for one day of a trending path with intraday + multi-day waves. `g0` is the global 15m index. */
export interface WaveOptions {
  dayWave?: number;
  dayPeriod?: number;
  barWave?: number;
  phase?: number;
}

export function trendDay15(g0: number, drift: number, base: number, opts: WaveOptions = {}): Bar[] {
  const ph = opts.phase ?? (drift < 0 ? 3 : 0);
  const close = (g: number) => base + drift * g + (opts.barWave ?? 1.2) * tri(g + ph, 6) + (opts.dayWave ?? 0) * tri(g + ph, opts.dayPeriod ?? 28 * 4);
  return Array.from({ length: 28 }, (_, i): Bar => {
    const g = g0 + i;
    const prev = close(g - 1);
    const c = close(g);
    const o = prev + 0.3 * (c - prev);
    return [o, Math.max(o, c) + 0.2, Math.min(o, c) - 0.2, c];
  });
}

export function sessionFrom(symbol: string, day: number, bars15: readonly Bar[], volume = 1000): TradingSession {
  const open = dayOpen(day);
  const candles: Candle[] = bars15.flatMap(expand).map(([o, h, l, c], i) => ({ symbol, timeframe: "5m", timestamp: open + i * M5, open: o, high: h, low: l, close: c, volume }));
  return { sessionId: `${symbol}-d${day}`, symbol, timeframe: "5m", openTimestamp: open, closeTimestamp: open + SESSION_MS, candles };
}

/** History days + current day for a trending symbol (current day may be overridden with explicit 15m bars). */
export function trendFeed(symbol: string, drift: number, base: number, current?: readonly Bar[], opts: WaveOptions = {}): TradingSession[] {
  const days: TradingSession[] = [];
  for (let d = 0; d <= HISTORY_DAYS; d++) {
    const bars = d === HISTORY_DAYS && current ? current : trendDay15(d * 28, drift, base, opts);
    days.push(sessionFrom(symbol, d, bars));
  }
  return days;
}

/** Target feed: uptrend history ending near the start of BULL_BARS, prior day with a 104 high (target level). */
export function bullTargetFeed(symbol = "TSLA", side: "BULLISH" | "BEARISH" = "BULLISH"): TradingSession[] {
  const drift = side === "BULLISH" ? 0.012 : -0.012;
  const start = side === "BULLISH" ? 95 - drift * HISTORY_DAYS * 28 : 105 - drift * HISTORY_DAYS * 28;
  const feed: TradingSession[] = [];
  for (let d = 0; d < HISTORY_DAYS; d++) {
    const bars = trendDay15(d * 28, drift, start, { barWave: 0.6 });
    if (d === HISTORY_DAYS - 1) {
      const [o, h, l, c] = bars[10] as Bar;
      bars[10] = side === "BULLISH" ? [o, Math.max(h, 104), l, c] : [o, h, Math.min(l, 96), c];
    }
    feed.push(sessionFrom(symbol, d, bars));
  }
  feed.push(sessionFrom(symbol, HISTORY_DAYS, side === "BULLISH" ? BULL_BARS : mirrorBars(BULL_BARS)));
  return feed;
}

/** Truncate a feed's current session to candles CLOSED at or before `asOf` (what was knowable). */
export function asOfFeed(feed: readonly TradingSession[], asOf: number): TradingSession[] {
  return feed
    .filter((s) => s.openTimestamp < asOf)
    .map((s) => ({ ...s, candles: s.candles.filter((c) => c.timestamp + M5 <= asOf) }));
}

export const END = dayOpen(HISTORY_DAYS) + 28 * M15; // close of the current session
