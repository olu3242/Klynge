import type { Direction, TechnicalState } from "../domain/types.ts";

export interface DirectionChecks {
  priceVsVwap: boolean;
  priceVsEma9: boolean;
  ema9Slope: boolean;
  structure: boolean;
}

export interface DirectionEvaluation {
  direction: Direction;
  bullish: DirectionChecks;
  bearish: DirectionChecks;
}

type DirectionInput = Pick<TechnicalState, "price" | "vwap" | "ema9" | "ema9Slope" | "structure">;

/**
 * STRICT classification. ALL conditions must hold — no majority vote, no weighting, no "3 of 4".
 * NaN comparisons are false, so malformed input falls through to NEUTRAL (fail-closed).
 */
export function evaluateDirection(s: DirectionInput): DirectionEvaluation {
  const bullish: DirectionChecks = {
    priceVsVwap: s.price > s.vwap,
    priceVsEma9: s.price > s.ema9,
    ema9Slope: s.ema9Slope > 0,
    structure: s.structure === "HH_HL",
  };
  const bearish: DirectionChecks = {
    priceVsVwap: s.price < s.vwap,
    priceVsEma9: s.price < s.ema9,
    ema9Slope: s.ema9Slope < 0,
    structure: s.structure === "LH_LL",
  };
  const all = (c: DirectionChecks) => c.priceVsVwap && c.priceVsEma9 && c.ema9Slope && c.structure;
  const direction: Direction = all(bullish) ? "BULLISH" : all(bearish) ? "BEARISH" : "NEUTRAL";
  return { direction, bullish, bearish };
}

export function classifyDirection(s: DirectionInput): Direction {
  return evaluateDirection(s).direction;
}
