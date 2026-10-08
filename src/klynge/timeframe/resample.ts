import { dataQualityFailure } from "../data-quality/series-quality.ts";
import type { Candle, DataQualityState, Timeframe, TradingSession } from "../domain/types.ts";
import { TIMEFRAME_MS } from "./timeframe.ts";

export interface ResampledSession {
  session: TradingSession;
  /** Close time of each derived candle (bucket end; the last intraday bucket may be shorter). */
  bucketEnds: number[];
  /** True when a bucket is still forming at `now` (not available yet — not an error). */
  forming: boolean;
  /** Present only when a bucket that should be complete is missing base bars. */
  failure?: DataQualityState;
}

/**
 * Session-anchored, deterministic resampling of CLOSED base candles.
 *   bucket k = [open + k·tf, min(open + (k+1)·tf, close)); "1d" = the whole session.
 * A bucket exists only once its end <= now (forming buckets are ignored, never errors).
 * A closed bucket must contain every expected base bar, otherwise MISSING_CANDLES (=> BLOCKED).
 */
export function resampleSession(session: TradingSession, target: Timeframe, now: number): ResampledSession {
  const baseMs = TIMEFRAME_MS[session.timeframe];
  const derived: Candle[] = [];
  const bucketEnds: number[] = [];
  let forming = false;
  const base: ResampledSession = {
    session: { sessionId: `${session.sessionId}:${target}`, symbol: session.symbol, timeframe: target, openTimestamp: session.openTimestamp, closeTimestamp: session.closeTimestamp, candles: derived },
    bucketEnds,
    forming,
  };
  if (target === session.timeframe) {
    for (const c of session.candles) {
      if (c.timestamp + baseMs <= now) {
        derived.push(c);
        bucketEnds.push(c.timestamp + baseMs);
      } else forming = true;
    }
    return { ...base, forming };
  }
  const span = target === "1d" ? session.closeTimestamp - session.openTimestamp : TIMEFRAME_MS[target];
  if (!(span > 0) || span % baseMs !== 0 || (session.closeTimestamp - session.openTimestamp) % baseMs !== 0) {
    return { ...base, failure: dataQualityFailure("BAD_DATA", `cannot derive ${target} from ${session.timeframe} for session ${session.sessionId}`) };
  }
  for (let start = session.openTimestamp; start < session.closeTimestamp; start += span) {
    const end = Math.min(start + span, session.closeTimestamp);
    if (end > now) {
      forming = forming || start <= now;
      break;
    }
    const bars = session.candles.filter((c) => c.timestamp >= start && c.timestamp < end);
    const expected = (end - start) / baseMs;
    const contiguous = bars.every((c, i) => c.timestamp === start + i * baseMs);
    if (bars.length !== expected || !contiguous) {
      return {
        ...base,
        forming,
        failure: dataQualityFailure("MISSING_CANDLES", `${session.symbol} ${target} bucket @${start} expected ${expected} ${session.timeframe} bars, found ${bars.length}`),
      };
    }
    const first = bars[0] as Candle;
    const last = bars[bars.length - 1] as Candle;
    derived.push({
      symbol: session.symbol,
      timeframe: target,
      timestamp: start,
      open: first.open,
      high: Math.max(...bars.map((b) => b.high)),
      low: Math.min(...bars.map((b) => b.low)),
      close: last.close,
      volume: bars.reduce((v, b) => v + b.volume, 0),
    });
    bucketEnds.push(end);
  }
  return { ...base, forming };
}
