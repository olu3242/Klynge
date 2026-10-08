import type { TimeframePolicy, TradingSession } from "./engine-core.ts";

export interface OhlcvPayload {
  target: TradingSession[];
  spx: TradingSession[];
  mnq: TradingSession[];
  volumeProxy?: TradingSession[];
  timeframePolicy?: TimeframePolicy;
  /** Historical evaluation time (epoch ms). Omitted => evaluate as of now. */
  asOf?: number;
}

export class OhlcvError extends Error {
  override readonly name = "OhlcvError";
}

const isSessionArray = (v: unknown): v is TradingSession[] =>
  Array.isArray(v) && v.length > 0 && v.every((s) => s && typeof s === "object" && typeof s.symbol === "string" && Array.isArray(s.candles) && typeof s.openTimestamp === "number");

/** Structural check only. Every candle is then validated by the engine's data-quality layer (fail closed). */
export function parseOhlcv(json: unknown): OhlcvPayload {
  const o = (json ?? {}) as Record<string, unknown>;
  if (!isSessionArray(o.target) || !isSessionArray(o.spx) || !isSessionArray(o.mnq)) throw new OhlcvError("OHLCV import needs non-empty target, spx and mnq session arrays");
  if (o.volumeProxy !== undefined && !isSessionArray(o.volumeProxy)) throw new OhlcvError("volumeProxy must be a non-empty session array");
  if (o.asOf !== undefined && !Number.isSafeInteger(o.asOf)) throw new OhlcvError("asOf must be epoch milliseconds");
  const total = [o.target, o.spx, o.mnq].reduce((n, f) => n + (f as TradingSession[]).reduce((m, s) => m + s.candles.length, 0), 0);
  if (total > 200_000) throw new OhlcvError("OHLCV import too large");
  return o as unknown as OhlcvPayload;
}
