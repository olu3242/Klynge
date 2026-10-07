import type { Timeframe } from "../domain/types.ts";

export type LevelType =
  | "SUPPORT"
  | "RESISTANCE"
  | "PRIOR_SESSION_HIGH"
  | "PRIOR_SESSION_LOW"
  | "SESSION_HIGH"
  | "SESSION_LOW"
  | "SWING_HIGH"
  | "SWING_LOW"
  | "VWAP";

export type LevelStrength = "WEAK" | "VALID" | "STRONG";

export interface PriceLevel {
  id: string;

  symbol: string;
  timeframe: Timeframe;

  price: number;

  type: LevelType;
  strength: LevelStrength;

  touches: number;

  confirmed: boolean;

  createdAt: number;
  confirmedAt?: number;
  lastTestedAt?: number;

  source: string;
}

export interface LevelPolicy {
  /** Confirmed same-side swings required to form SUPPORT/RESISTANCE (integer >= 2). */
  minimumTouches: number;
  /** Touch/cluster tolerance = atrToleranceMultiplier × ATR14. */
  atrToleranceMultiplier: number;
}

export const DEFAULT_LEVEL_POLICY: Readonly<LevelPolicy> = Object.freeze({
  minimumTouches: 2,
  atrToleranceMultiplier: 0.25,
});

export function assertValidLevelPolicy(p: LevelPolicy): void {
  if (!Number.isSafeInteger(p.minimumTouches) || p.minimumTouches < 2) throw new RangeError("LevelPolicy.minimumTouches must be an integer >= 2");
  if (!Number.isFinite(p.atrToleranceMultiplier) || p.atrToleranceMultiplier < 0) throw new RangeError("LevelPolicy.atrToleranceMultiplier must be >= 0");
}

/** Levels that resist upside (bullish break candidates). */
export const RESISTANCE_TYPES: readonly LevelType[] = Object.freeze(["RESISTANCE", "PRIOR_SESSION_HIGH"]);
/** Levels that support downside (bearish break candidates). */
export const SUPPORT_TYPES: readonly LevelType[] = Object.freeze(["SUPPORT", "PRIOR_SESSION_LOW"]);
