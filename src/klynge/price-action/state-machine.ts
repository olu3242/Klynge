import type { Candle } from "../domain/types.ts";
import type { PriceLevel } from "../levels/types.ts";
import { assertTransition } from "./transitions.ts";
import type { PriceActionLifecycle, PriceActionPolicy, PriceActionResult, PriceActionState, PriceActionTransition, SetupSide } from "./types.ts";

export interface PriceActionInput {
  candles: readonly Candle[];
  level: Pick<PriceLevel, "id" | "price">;
  side: SetupSide;
  /** First candle index the level is known for (strictly after its confirmation). */
  startIndex: number;
  /** ATR known at each candle (atrSeries). Candles with null ATR cannot change lifecycle state. */
  atrAt: readonly (number | null)[];
  policy: PriceActionPolicy;
  /** Whether a NEW lifecycle may start at `index` (level still current). Default: always. */
  canStartLifecycle?: (index: number) => boolean;
}

/** Structural invalidation: beyond the more adverse of level and retest extreme, plus ATR tolerance. */
export function structuralInvalidation(side: SetupSide, levelPrice: number, retestExtreme: number, atr: number, toleranceAtr: number): number {
  return side === "BULLISH" ? Math.min(levelPrice, retestExtreme) - toleranceAtr * atr : Math.max(levelPrice, retestExtreme) + toleranceAtr * atr;
}

/**
 * Deterministic, closed-candle price-action lifecycle for one level and one side.
 * Uses signed "favorable distance" s(x) = d·(x − level), d = +1 bullish / −1 bearish, so both sides share one rule set.
 */
export function runPriceAction(input: PriceActionInput): PriceActionResult {
  const { candles, level, side, policy } = input;
  const d = side === "BULLISH" ? 1 : -1;
  const L = level.price;
  const s = (x: number) => d * (x - L);
  const favorableExtreme = (c: Candle) => (side === "BULLISH" ? c.high : c.low);
  const adverseExtreme = (c: Candle) => (side === "BULLISH" ? c.low : c.high);
  const moreAdverse = (a: number, b: number) => (side === "BULLISH" ? Math.min(a, b) : Math.max(a, b));

  let state = "WAITING" as PriceActionState;
  const transitions: PriceActionTransition[] = [];
  const lifecycles: PriceActionLifecycle[] = [];
  let lc: PriceActionLifecycle | undefined;

  const move = (to: PriceActionState, i: number, reason: string) => {
    if (to === state) return;
    assertTransition(state, to);
    const t: PriceActionTransition = { from: state, to, index: i, timestamp: (candles[i] as Candle).timestamp, reason };
    transitions.push(t);
    if (lc && to !== "WAITING" && to !== "TESTING") lc.transitions.push(t);
    state = to;
    if (lc) lc.state = to === "WAITING" || to === "TESTING" ? lc.state : to;
  };

  // Armed = price has been on the origin side (at/before the level) since the last lifecycle began.
  const start = Math.max(0, input.startIndex);
  const prev = candles[start - 1];
  let armed = prev ? s(prev.close) <= 0 : candles[start] ? s((candles[start] as Candle).open) <= 0 : false;

  for (let i = start; i < candles.length; i++) {
    const c = candles[i] as Candle;
    const atr = input.atrAt[i] ?? null;
    if (atr === null || !(atr > 0)) {
      if (s(c.close) <= 0) armed = true;
      continue;
    }
    const breakDist = policy.break.minimumCloseDistanceAtr * atr;
    const failDist = policy.acceptance.maximumFailureDistanceAtr * atr;
    const retestTol = policy.retest.toleranceAtr * atr;
    const maxDepth = policy.retest.maximumDepthAtr * atr;
    const touchTol = policy.touchToleranceAtr * atr;
    const freshBreak = armed && s(c.close) >= breakDist && (input.canStartLifecycle?.(i) ?? true);

    switch (state) {
      case "FAILED":
      case "INVALIDATED":
      case "WAITING":
      case "TESTING": {
        if (freshBreak) {
          if (state === "FAILED" || state === "INVALIDATED") move("WAITING", i, "new lifecycle");
          lc = { levelId: level.id, levelPrice: L, side, state: "BROKEN", startedAt: c.timestamp, breakIndex: i, acceptanceCloses: 0, transitions: [] };
          lifecycles.push(lc);
          move("BROKEN", i, "closed beyond level by the break threshold");
          armed = false;
        } else if (state === "WAITING" || state === "TESTING") {
          move(s(favorableExtreme(c)) >= -touchTol ? "TESTING" : "WAITING", i, s(favorableExtreme(c)) >= -touchTol ? "price touched the level" : "price moved away from the level");
        }
        break;
      }
      case "BROKEN": {
        const l = lc as PriceActionLifecycle;
        if (s(c.close) <= -failDist) {
          move("FAILED", i, "closed materially back through the level before acceptance");
          l.endedAt = c.timestamp;
          l.endReason = "Break failed: price closed materially back through the level.";
        } else if (s(c.close) > 0) {
          l.acceptanceCloses += 1;
          if (l.acceptanceCloses >= policy.acceptance.requiredCloses) {
            l.acceptedAt = c.timestamp;
            move("ACCEPTED", i, `${l.acceptanceCloses} consecutive closes held beyond the level`);
          }
        } else {
          l.acceptanceCloses = 0;
        }
        break;
      }
      case "ACCEPTED": {
        const l = lc as PriceActionLifecycle;
        if (s(c.close) <= -failDist) {
          move("FAILED", i, "failed retest: returned to the level and closed materially back through it");
          l.endedAt = c.timestamp;
          l.endReason = "Failed retest: price closed materially back through the reclaimed level.";
        } else if (s(adverseExtreme(c)) <= retestTol) {
          if (s(adverseExtreme(c)) < -maxDepth) {
            move("FAILED", i, "retest probed too deep through the level");
            l.endedAt = c.timestamp;
            l.endReason = "Retest too deep: price probed materially through the reclaimed level.";
          } else {
            l.retestStartedAt = c.timestamp;
            l.retestExtreme = adverseExtreme(c);
            move("RETESTING", i, "price returned to the broken level");
          }
        }
        break;
      }
      case "RETESTING": {
        const l = lc as PriceActionLifecycle;
        const prevCandle = candles[i - 1] as Candle;
        if (s(c.close) <= -failDist) {
          move("FAILED", i, "failed retest: closed materially back through the reclaimed level");
          l.endedAt = c.timestamp;
          l.endReason = "Failed retest: price closed materially back through the reclaimed level.";
        } else if (s(adverseExtreme(c)) < -maxDepth) {
          move("FAILED", i, "retest probed too deep through the level");
          l.endedAt = c.timestamp;
          l.endReason = "Retest too deep: price probed materially through the reclaimed level.";
        } else {
          l.retestExtreme = moreAdverse(l.retestExtreme as number, adverseExtreme(c));
          // Continuation: close beyond the previous (retest-phase) candle's favorable extreme, and beyond the level.
          if (s(c.close) > 0 && d * (c.close - favorableExtreme(prevCandle)) > 0) {
            l.continuationIndex = i;
            l.confirmedAt = c.timestamp;
            l.invalidation = structuralInvalidation(side, L, l.retestExtreme, atr, policy.invalidationToleranceAtr);
            move("CONFIRMED", i, "continuation close beyond the retest");
          }
        }
        break;
      }
      case "CONFIRMED": {
        const l = lc as PriceActionLifecycle;
        if (d * (c.close - (l.invalidation as number)) < 0) {
          move("INVALIDATED", i, "closed beyond structural invalidation");
          l.endedAt = c.timestamp;
          l.endReason = "Invalidation breached: price closed beyond structural invalidation.";
        }
        break;
      }
    }
    if (s(c.close) <= 0) armed = true;
  }

  return { levelId: level.id, side, state, lifecycles, transitions };
}
