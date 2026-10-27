/** Historical reaction memory. Input bars must be completed and timestamped.
 * Reaction candidates are calculated using ONLY bars available at evaluatedAt.
 * This is contextual evidence, never trade permission.
 */
import type { Candle } from "../domain/types.ts";
export type ReactionSide = "SUPPORT" | "RESISTANCE";
export interface HistoricalReaction {
  side: ReactionSide;
  price: number;
  touches: number;
  lastTouchedAt: number;
  firstTouchedAt: number;
  strongestReaction: number;
}
export interface ReactionMemoryInput {
  candles: readonly Candle[];
  evaluatedAt: number;
  /** Absolute tolerance in price units, positive and finite. */
  tolerance: number;
  /** Minimum independent reaction events to publish a level. */
  minimumTouches?: number;
}
export function discoverHistoricalReactions(input: ReactionMemoryInput): readonly HistoricalReaction[] {
  const { candles, evaluatedAt, tolerance } = input;
  const minimumTouches = input.minimumTouches ?? 2;
  if (!Number.isFinite(evaluatedAt) || !Number.isFinite(tolerance) || tolerance <= 0 ||
      !Number.isSafeInteger(minimumTouches) || minimumTouches < 2)
    throw new RangeError("Invalid historical reaction policy");
  const eligible = candles.filter(b => {
    const duration = b.timeframe === "1d" ? 86400000 : b.timeframe === "5m" ? 300000 : undefined;
    if (duration === undefined) throw new RangeError("Only 5m and 1d historical reaction inputs supported");
    if (![b.timestamp,b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite) ||
        b.low > Math.min(b.open,b.close) || b.high < Math.max(b.open,b.close) || b.volume < 0)
      throw new RangeError("Malformed historical OHLCV");
    return b.timestamp + duration <= evaluatedAt;
  });
  for (let i = 1; i < candles.length; i++)
    if ((candles[i] as Candle).timestamp <= (candles[i-1] as Candle).timestamp) throw new RangeError("History must be strictly ordered");
  const events: { side: ReactionSide; price: number; timestamp: number; magnitude: number }[] = [];
  for (const b of eligible) {
    if (b.close > b.open && b.close > b.low)
      events.push({side:"SUPPORT",price:b.low,timestamp:b.timestamp,magnitude:b.close-b.low});
    if (b.close < b.open && b.high > b.close)
      events.push({side:"RESISTANCE",price:b.high,timestamp:b.timestamp,magnitude:b.high-b.close});
  }
  const groups: typeof events[] = [];
  for (const event of events) {
    const group = groups.find(g => (g[0] as (typeof g)[number]).side === event.side && Math.abs(event.price - g.reduce((s,e)=>s+e.price,0)/g.length) <= tolerance);
    if (group) group.push(event);
    else groups.push([event]);
  }
  return groups.filter(g=>g.length >= minimumTouches).map(g=>({
    side:(g[0] as (typeof g)[number]).side, price:g.reduce((s,e)=>s+e.price,0)/g.length, touches:g.length,
    firstTouchedAt:(g[0] as (typeof g)[number]).timestamp,lastTouchedAt:(g[g.length-1] as (typeof g)[number]).timestamp,
    strongestReaction:Math.max(...g.map(e=>e.magnitude))
  })).sort((a,b)=>b.touches-a.touches || b.lastTouchedAt-a.lastTouchedAt);
}
