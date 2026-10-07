import type { Candle, Timeframe, TradingSession } from "./domain/types.ts";
import { TIMEFRAME_MS } from "./timeframe/timeframe.ts";

export const T0 = Date.UTC(2026, 2, 2, 14, 30); // 09:30 ET session open
export const FIVE_MIN = TIMEFRAME_MS["5m"];

export type Trend = "up" | "down" | "flat";

export interface SessionOptions {
  symbol?: string;
  timeframe?: Timeframe;
  n?: number;
  trend?: Trend;
  base?: number;
  volume?: number;
  lastVolume?: number;
  open?: number;
}

/** Triangle wave in [-1, 1] with period 6 — produces confirmed swings every 6 bars at lookback 2. */
function wave(i: number): number {
  const p = i % 6;
  return p <= 3 ? -1 + (2 * p) / 3 : 1 - (2 * (p - 3)) / 3;
}

export function makeCloses(n: number, trend: Trend, base = 100): number[] {
  const drift = trend === "up" ? 0.6 : trend === "down" ? -0.6 : 0;
  // Offset the wave so the series ends on a leg moving with the trend.
  return Array.from({ length: n }, (_, i) => base + i * drift + 1.5 * wave(trend === "down" ? i + 3 : i));
}

export function makeCandles(opts: SessionOptions = {}): Candle[] {
  const { symbol = "SPX", timeframe = "5m", n = 30, trend = "up", base = 100, volume = 1000, open = T0 } = opts;
  const tf = TIMEFRAME_MS[timeframe];
  const closes = makeCloses(n, trend, base);
  return closes.map((close, i) => {
    const prevClose = i === 0 ? close : (closes[i - 1] as number);
    // Open 30% of the way from the prior close so adjacent bars never tie at a pivot.
    const prev = prevClose + 0.3 * (close - prevClose);
    return {
      symbol,
      timeframe,
      timestamp: open + i * tf,
      open: prev,
      high: Math.max(prev, close) + 0.25,
      low: Math.min(prev, close) - 0.25,
      close,
      volume: i === n - 1 && opts.lastVolume !== undefined ? opts.lastVolume : volume,
    };
  });
}

export function makeSession(opts: SessionOptions = {}): TradingSession {
  const candles = makeCandles(opts);
  const first = candles[0] as Candle;
  const open = opts.open ?? T0;
  return {
    sessionId: `${first.symbol}-2026-03-02`,
    symbol: first.symbol,
    timeframe: first.timeframe,
    openTimestamp: open,
    closeTimestamp: open + 6.5 * 60 * 60_000,
    candles,
  };
}

/** Clock exactly at the close of the last candle. */
export function nowAfter(session: TradingSession): number {
  const last = session.candles[session.candles.length - 1] as Candle;
  return last.timestamp + TIMEFRAME_MS[session.timeframe];
}

export function withCandle(session: TradingSession, index: number, patch: Partial<Candle>): TradingSession {
  return { ...session, candles: session.candles.map((c, i) => (i === index ? { ...c, ...patch } : c)) };
}
