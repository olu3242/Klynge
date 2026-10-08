import type { Candle, Timeframe } from "../domain/types.ts";
import type { SessionCalendar } from "../providers/calendar.ts";
import { TIMEFRAME_MS } from "../timeframe/timeframe.ts";

/**
 * Aggregate fine bars (e.g. vendor 1m) into a coarser timeframe aligned to each regular session's open.
 * Trade-based vendors omit minutes without trades, so a bucket is built from the bars that exist; a bucket with NO
 * bars is left absent (never filled) — downstream normalization then fails closed on the gap. Only buckets that have
 * fully closed by `now` are emitted. Bars outside regular sessions are dropped (calendar decides, not the vendor).
 */
export function aggregateBars(bars: readonly Candle[], target: Timeframe, calendar: SessionCalendar, now: number): Candle[] {
  const tf = TIMEFRAME_MS[target];
  const buckets = new Map<number, Candle>();
  for (const b of [...bars].sort((x, y) => x.timestamp - y.timestamp)) {
    const w = calendar.sessionAt(b.timestamp);
    if (!w) continue;
    const start = target === "1d" ? w.openTimestamp : w.openTimestamp + Math.floor((b.timestamp - w.openTimestamp) / tf) * tf;
    const end = target === "1d" ? w.closeTimestamp : Math.min(start + tf, w.closeTimestamp);
    if (end > now) continue;
    const cur = buckets.get(start);
    if (!cur) buckets.set(start, { symbol: b.symbol, timeframe: target, timestamp: start, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume });
    else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume;
    }
  }
  return [...buckets.values()].sort((a, b) => a.timestamp - b.timestamp);
}
