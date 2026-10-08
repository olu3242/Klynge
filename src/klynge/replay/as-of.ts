import type { TradingSession } from "../domain/types.ts";
import { TIMEFRAME_MS } from "../timeframe/timeframe.ts";
import type { ReplayFrame } from "./types.ts";

export class LookaheadViolation extends Error {
  override readonly name = "LookaheadViolation";
}

/** Throws if any source timestamp is after `timestamp` (information that did not exist yet). */
export function assertAsOf(timestamp: number, sourceTimestamps: Iterable<number>, label = "source"): void {
  for (const t of sourceTimestamps) {
    if (!(t <= timestamp)) throw new LookaheadViolation(`${label} timestamp ${t} is after as-of ${timestamp}`);
  }
}

/** What was knowable at `asOf`: sessions already opened, candles already CLOSED (open + tf <= asOf). */
export function feedAsOf(sessions: readonly TradingSession[], asOf: number): TradingSession[] {
  return sessions
    .filter((s) => s.openTimestamp < asOf)
    .map((s) => ({ ...s, candles: s.candles.filter((c) => c.timestamp + TIMEFRAME_MS[c.timeframe] <= asOf) }));
}

export function candleCloseTimes(sessions: readonly TradingSession[]): number[] {
  return sessions.flatMap((s) => s.candles.map((c) => c.timestamp + TIMEFRAME_MS[c.timeframe]));
}

/** Every timestamp a frame's outputs depend on must be at or before the frame time. */
export function assertFrameAsOf(frame: ReplayFrame): void {
  const T = frame.timestamp;
  assertAsOf(T, [frame.marketTruth.provenance.evaluatedAt], "market truth clock");
  const mt = frame.marketTruth.technical;
  for (const s of [mt.spx, mt.mnq]) if (s) assertAsOf(T, [s.timestamp + TIMEFRAME_MS[s.timeframe]], `${s.symbol} technical state`);
  const d = frame.setupDecision;
  if (d) {
    assertAsOf(T, [d.provenance.evaluatedAt, d.timestamp], "setup decision");
    const tf = TIMEFRAME_MS[d.timeframe];
    assertAsOf(T, d.transitions.map((t) => t.timestamp + tf), "price-action transition");
    if (d.level) assertAsOf(T, [d.level.createdAt, ...(d.level.confirmedAt !== undefined ? [d.level.confirmedAt] : []), ...(d.level.lastTestedAt !== undefined ? [d.level.lastTestedAt] : [])], "level");
    if (d.setup) assertAsOf(T, [d.setup.startedAt + tf], "setup lifecycle");
  }
  const m = frame.multiTimeframe;
  if (m) {
    assertAsOf(T, [m.timestamp], "multi-timeframe clock");
    assertAsOf(T, m.roles.flatMap((r) => (r.lastClosedAt === null ? [] : [r.lastClosedAt])), "timeframe role");
  }
  const o = frame.optionsDecision;
  if (o) assertAsOf(T, [o.timestamp, o.chainTimestamp, ...o.eligibleContracts.map((c) => c.timestamp)], "options decision");
}
