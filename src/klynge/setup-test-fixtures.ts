/**
 * Hand-built setup sequences (5m). Bullish: resistance cluster (two swing highs ≈102.03) -> break (i=23)
 * -> 2 acceptance closes -> retest (i=26) -> continuation (i=27). Bearish fixtures are exact price mirrors.
 */
import type { Candle, TradingSession } from "./domain/types.ts";
import { evaluateMarketTruth } from "./engine/market-truth.ts";
import { FIVE_MIN, makeSession, T0 } from "./test-fixtures.ts";

type Bar = [open: number, high: number, low: number, close: number];

export const BULL_BARS: readonly Bar[] = [
  [95.0, 95.6, 94.8, 95.4], [95.4, 96.1, 95.2, 95.9], [95.9, 96.6, 95.7, 96.4], [96.4, 97.1, 96.2, 96.9],
  [96.9, 97.6, 96.7, 97.4], [97.4, 98.1, 97.2, 97.9], [97.9, 98.6, 97.7, 98.4], [98.4, 99.1, 98.2, 98.9],
  [98.9, 99.6, 98.7, 99.4], [99.4, 100.1, 99.2, 99.9], [99.9, 100.6, 99.7, 100.4], [100.4, 101.0, 100.1, 100.8],
  [100.8, 101.4, 100.5, 101.2], [101.2, 102.0, 101.0, 101.6], // 13: swing high H1 = 102.00
  [101.6, 101.7, 100.9, 101.1], [101.1, 101.3, 100.4, 100.7], // 15: swing low L1 = 100.40
  [100.7, 101.4, 100.6, 101.3], [101.3, 101.9, 101.1, 101.7],
  [101.7, 102.05, 101.4, 101.8], // 18: swing high H2 = 102.05  => RESISTANCE ≈ 102.025
  [101.8, 101.9, 101.2, 101.4], [101.4, 101.5, 100.9, 101.1], // 20: swing low L2 = 100.90 (HL)
  [101.1, 101.6, 101.0, 101.5], [101.5, 101.95, 101.3, 101.9], // 22: tests resistance, closes below
  [101.9, 102.5, 101.8, 102.4], // 23: BREAK (close beyond threshold)
  [102.4, 102.5, 102.2, 102.3], [102.3, 102.6, 102.2, 102.45], // 24-25: acceptance closes
  [102.45, 102.5, 102.05, 102.15], // 26: RETEST
  [102.15, 102.6, 102.1, 102.55], // 27: CONTINUATION
];
export const BREAK_INDEX = 23;
export const RETEST_INDEX = 26;
export const CONTINUATION_INDEX = 27;
export const PRIOR_OPEN = T0 - 24 * 60 * 60_000;

export function barsToCandles(symbol: string, bars: readonly Bar[], open = T0, volumes?: readonly number[]): Candle[] {
  return bars.map(([o, h, l, c], i) => ({ symbol, timeframe: "5m", timestamp: open + i * FIVE_MIN, open: o, high: h, low: l, close: c, volume: volumes?.[i] ?? 1000 }));
}

export function sessionOf(symbol: string, candles: Candle[], open = T0, closeTimestamp = open + 6.5 * 60 * 60_000): TradingSession {
  return { sessionId: `${symbol}-${open}`, symbol, timeframe: "5m", openTimestamp: open, closeTimestamp, candles };
}

/** Mirror prices around `center` (bullish <-> bearish), swapping high/low. */
export function mirrorBars(bars: readonly Bar[], center = 100): Bar[] {
  return bars.map(([o, h, l, c]) => [2 * center - o, 2 * center - l, 2 * center - h, 2 * center - c]);
}

/** Prior session: flat, with a high (target for bullish) and a low (target for bearish). */
export function priorBars(high: number, low: number): Bar[] {
  return Array.from({ length: 30 }, (_, i): Bar => {
    if (i === 10) return [100, high, 99.8, 100.1];
    if (i === 20) return [100, 100.2, low, 99.9];
    return [100, 100.3, 99.7, 100];
  });
}

export interface ScenarioOptions {
  side?: "BULLISH" | "BEARISH";
  bars?: readonly Bar[];
  volumes?: readonly number[];
  priorHigh?: number;
  priorLow?: number;
  withPrior?: boolean;
  market?: "aligned" | "opposite" | "mixed" | "stale";
  now?: number;
}

/** Full scenario: target session + prior session + market truth (SPX/MNQ trend matched to side). */
export function scenario(opts: ScenarioOptions = {}) {
  const side = opts.side ?? "BULLISH";
  const base = opts.bars ?? BULL_BARS;
  const bars = side === "BULLISH" ? base : mirrorBars(base);
  const n = bars.length;
  const target = sessionOf("TSLA", barsToCandles("TSLA", bars, T0, opts.volumes));
  const pBars = side === "BULLISH" ? priorBars(opts.priorHigh ?? 104, opts.priorLow ?? 97) : mirrorBars(priorBars(opts.priorHigh ?? 104, opts.priorLow ?? 97));
  const priorSession = sessionOf("TSLA", barsToCandles("TSLA", pBars, PRIOR_OPEN), PRIOR_OPEN, PRIOR_OPEN + pBars.length * FIVE_MIN);
  const now = opts.now ?? T0 + n * FIVE_MIN;
  const market = opts.market ?? "aligned";
  const up = side === "BULLISH";
  const spxTrend = market === "opposite" ? (up ? "down" : "up") : up ? "up" : "down";
  const mnqTrend = market === "mixed" ? (up ? "down" : "up") : spxTrend;
  const marketTruth = evaluateMarketTruth({
    spx: makeSession({ symbol: "SPX", trend: spxTrend, n }),
    mnq: makeSession({ symbol: "MNQ", trend: mnqTrend, n }),
    now: market === "stale" ? now + 60 * 60_000 : now,
  });
  return { target, priorSession: opts.withPrior === false ? undefined : priorSession, now: market === "stale" ? now + 60 * 60_000 : now, marketTruth };
}
