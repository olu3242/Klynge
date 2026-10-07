import type { Candle, SwingPoint, TradingSession } from "../domain/types.ts";
import { atr, ATR_PERIOD } from "../indicators/atr.ts";
import { vwapSeries } from "../indicators/vwap.ts";
import { DEFAULT_SWING_LOOKBACK, findSwingPoints, swingsKnownAt } from "../structure/swings.ts";
import { clusterSwings } from "./clustering.ts";
import { levelId } from "./level-id.ts";
import { assertValidLevelPolicy, DEFAULT_LEVEL_POLICY } from "./types.ts";
import type { LevelPolicy, LevelStrength, LevelType, PriceLevel } from "./types.ts";

export interface LevelDiscoveryInput {
  session: TradingSession;
  /** Completed prior session (same symbol/timeframe). Must be validated by the caller. */
  priorSession?: TradingSession;
  /** Inclusive index of the last CLOSED candle that may be used (no lookahead). Defaults to the last candle. */
  asOfIndex?: number;
  policy?: LevelPolicy;
  swingLookback?: number;
  /** Pre-computed swings for `session.candles` (optimization; must equal findSwingPoints output). */
  swings?: readonly SwingPoint[];
}

const TYPE_ORDER: readonly LevelType[] = ["PRIOR_SESSION_HIGH", "PRIOR_SESSION_LOW", "SESSION_HIGH", "SESSION_LOW", "RESISTANCE", "SUPPORT", "SWING_HIGH", "SWING_LOW", "VWAP"];

function strengthFor(touches: number, minimumTouches: number): LevelStrength {
  if (touches > minimumTouches) return "STRONG";
  if (touches === minimumTouches) return "VALID";
  return "WEAK";
}

function lastTested(candles: readonly Candle[], price: number, tolerance: number | null, after: number): number | undefined {
  if (tolerance === null) return undefined;
  let ts: number | undefined;
  for (const c of candles) {
    if (c.timestamp > after && c.low - tolerance <= price && c.high + tolerance >= price) ts = c.timestamp;
  }
  return ts;
}

/**
 * Deterministic level discovery as of `asOfIndex`:
 *   PRIOR_SESSION_HIGH/LOW  confirmed at prior close, VALID
 *   SESSION_HIGH/LOW        running extremes, unconfirmed (dynamic), WEAK
 *   SWING_HIGH/LOW          each confirmed swing, WEAK (single touch)
 *   RESISTANCE/SUPPORT      ATR-tolerance clusters of >= minimumTouches confirmed swings
 *   VWAP                    session VWAP, unconfirmed (dynamic), WEAK
 * Only `confirmed` levels are tradable (break or target). Output sorted by price, type, id.
 */
export function discoverLevels(input: LevelDiscoveryInput): PriceLevel[] {
  const policy = input.policy ?? DEFAULT_LEVEL_POLICY;
  assertValidLevelPolicy(policy);
  const { session } = input;
  const { symbol, timeframe } = session;
  const asOf = Math.min(input.asOfIndex ?? session.candles.length - 1, session.candles.length - 1);
  const known = session.candles.slice(0, asOf + 1);
  const levels: PriceLevel[] = [];
  const atr14 = known.length > ATR_PERIOD ? atr(known, ATR_PERIOD) : null;
  const tolerance = atr14 === null ? null : atr14 * policy.atrToleranceMultiplier;

  const push = (type: LevelType, price: number, createdAt: number, fields: Partial<PriceLevel> & Pick<PriceLevel, "strength" | "touches" | "confirmed" | "source">) => {
    const level: PriceLevel = { id: levelId(symbol, timeframe, type, price, createdAt), symbol, timeframe, price, type, createdAt, ...fields };
    const tested = lastTested(known, price, tolerance, fields.confirmedAt ?? createdAt);
    if (tested !== undefined) level.lastTestedAt = tested;
    levels.push(level);
  };

  // Prior session extremes.
  const prior = input.priorSession;
  if (prior && prior.candles.length > 0) {
    const hi = prior.candles.reduce((a, c) => (c.high > a.high ? c : a));
    const lo = prior.candles.reduce((a, c) => (c.low < a.low ? c : a));
    push("PRIOR_SESSION_HIGH", hi.high, hi.timestamp, { strength: "VALID", touches: 1, confirmed: true, confirmedAt: prior.closeTimestamp, source: `prior session ${prior.sessionId} high` });
    push("PRIOR_SESSION_LOW", lo.low, lo.timestamp, { strength: "VALID", touches: 1, confirmed: true, confirmedAt: prior.closeTimestamp, source: `prior session ${prior.sessionId} low` });
  }

  if (known.length === 0) return levels;

  // Current session running extremes (dynamic).
  const hi = known.reduce((a, c) => (c.high > a.high ? c : a));
  const lo = known.reduce((a, c) => (c.low < a.low ? c : a));
  push("SESSION_HIGH", hi.high, hi.timestamp, { strength: "WEAK", touches: 1, confirmed: false, source: `session ${session.sessionId} high` });
  push("SESSION_LOW", lo.low, lo.timestamp, { strength: "WEAK", touches: 1, confirmed: false, source: `session ${session.sessionId} low` });

  // Confirmed swings known at asOf.
  const lookback = input.swingLookback ?? DEFAULT_SWING_LOOKBACK;
  const swings = swingsKnownAt(input.swings ?? findSwingPoints(session.candles, lookback), asOf);
  for (const s of swings) {
    push(s.type === "HIGH" ? "SWING_HIGH" : "SWING_LOW", s.price, s.timestamp, {
      strength: "WEAK",
      touches: 1,
      confirmed: true,
      confirmedAt: s.confirmedAtTimestamp,
      source: `confirmed swing ${s.type.toLowerCase()} @${s.index}`,
    });
  }

  // Support / resistance clusters.
  if (tolerance !== null) {
    for (const side of ["HIGH", "LOW"] as const) {
      for (const cluster of clusterSwings(swings.filter((s) => s.type === side), tolerance, policy.minimumTouches)) {
        const byTime = [...cluster.members].sort((a, b) => a.confirmedAtIndex - b.confirmedAtIndex || a.index - b.index);
        const createdAt = Math.min(...cluster.members.map((m) => m.timestamp));
        const qualifying = byTime[policy.minimumTouches - 1] as SwingPoint;
        push(side === "HIGH" ? "RESISTANCE" : "SUPPORT", cluster.price, createdAt, {
          strength: strengthFor(cluster.members.length, policy.minimumTouches),
          touches: cluster.members.length,
          confirmed: true,
          confirmedAt: qualifying.confirmedAtTimestamp,
          source: `cluster of ${cluster.members.length} confirmed swing ${side.toLowerCase()}s`,
        });
      }
    }
  }

  // Session VWAP (dynamic).
  const vwap = vwapSeries(known, () => session.sessionId).at(-1) ?? null;
  const lastKnown = known[known.length - 1] as Candle;
  if (vwap !== null) push("VWAP", vwap, lastKnown.timestamp, { strength: "WEAK", touches: 0, confirmed: false, source: "session VWAP" });

  return levels.sort((a, b) => a.price - b.price || TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Tradable = confirmed and at least VALID strength, of the side relevant to `direction`. */
export function isTradableBreakLevel(level: PriceLevel, types: readonly LevelType[]): boolean {
  return level.confirmed && level.strength !== "WEAK" && types.includes(level.type);
}
