import { deepFreeze } from "../domain/freeze.ts";
import type { PriceLevel } from "../levels/types.ts";
import type { SetupSide } from "../price-action/types.ts";

export type RiskLevel = "LOW" | "MODERATE" | "ELEVATED" | "HIGH" | "BLOCKED";

export interface PriceZone {
  min: number;
  max: number;
}

export type RiskBlockerCode = "INVALID_ATR" | "NO_LEVEL" | "NO_INVALIDATION" | "NO_TARGET" | "STOP_TOO_WIDE" | "INSUFFICIENT_REWARD_RISK" | "PRICE_EXTENDED";

export interface RiskState {
  allowed: boolean;

  level: RiskLevel;

  entryZone?: PriceZone;

  invalidation?: number;

  stopDistance?: number;

  target?: number;
  targetLevelId?: string;

  rewardRiskRatio?: number;

  atr14: number;

  reasons: string[];
  blockers: RiskBlockerCode[];
}

export interface RiskPolicy {
  minimumRewardRiskRatio: number;
  /** stopDistance / ATR14 above this => BLOCKED. */
  maximumStopAtr: number;
  /** Entry zone width beyond the reclaimed level (× ATR). */
  entryToleranceAtr: number;
  /** Structural invalidation buffer beyond retest extreme / level (× ATR). */
  invalidationToleranceAtr: number;
  /** Current price beyond the entry zone by more than this × ATR => BLOCKED (setup has left its zone). */
  maximumExtensionAtr: number;
}

export const DEFAULT_RISK_POLICY: Readonly<RiskPolicy> = Object.freeze({
  minimumRewardRiskRatio: 2.0,
  maximumStopAtr: 1.5,
  entryToleranceAtr: 0.25,
  invalidationToleranceAtr: 0.25,
  maximumExtensionAtr: 1.0,
});

export function assertValidRiskPolicy(p: RiskPolicy): void {
  for (const [k, v] of Object.entries(p)) if (!Number.isFinite(v) || v < 0) throw new RangeError(`RiskPolicy.${k} must be a finite, non-negative number`);
  if (p.maximumStopAtr <= 0) throw new RangeError("RiskPolicy.maximumStopAtr must be > 0");
}

export interface RiskInput {
  side: SetupSide;
  /** The broken/reclaimed setup level. */
  level?: Pick<PriceLevel, "id" | "price">;
  /** Structural invalidation from the price-action lifecycle. */
  invalidation?: number;
  /** Candidate target levels (confirmed, as of evaluation). */
  levels: readonly PriceLevel[];
  /** Levels already broken (closed through) — not valid targets. */
  brokenLevelIds?: ReadonlySet<string>;
  currentPrice: number;
  atr14: number;
  policy?: RiskPolicy;
}

/** Entry zone: from the reclaimed level outward by entryToleranceAtr × ATR. Never a fake exact price. */
export function entryZone(side: SetupSide, levelPrice: number, atr14: number, policy: RiskPolicy): PriceZone {
  const w = policy.entryToleranceAtr * atr14;
  return side === "BULLISH" ? { min: levelPrice, max: levelPrice + w } : { min: levelPrice - w, max: levelPrice };
}

function riskLevelFor(stopAtr: number, policy: RiskPolicy): RiskLevel {
  const f = stopAtr / policy.maximumStopAtr;
  if (f <= 1 / 3) return "LOW";
  if (f <= 2 / 3) return "MODERATE";
  if (f <= 0.85) return "ELEVATED";
  return "HIGH";
}

/**
 * Deterministic risk gate. A technically confirmed setup can still be BLOCKED here.
 *   entry      = entry-zone midpoint
 *   risk       = |entry − invalidation|
 *   reward     = |target − entry|, target = nearest unbroken confirmed level beyond the entry zone
 *   R:R        = reward / risk
 */
export function evaluateRisk(input: RiskInput): Readonly<RiskState> {
  const policy = input.policy ?? DEFAULT_RISK_POLICY;
  assertValidRiskPolicy(policy);
  const { side, atr14 } = input;
  const d = side === "BULLISH" ? 1 : -1;
  const reasons: string[] = [];
  const blockers: RiskBlockerCode[] = [];
  const block = (code: RiskBlockerCode, reason: string) => {
    blockers.push(code);
    reasons.push(reason);
  };
  const done = (extra: Omit<RiskState, "allowed" | "level" | "atr14" | "reasons" | "blockers"> = {}): Readonly<RiskState> => {
    const allowed = blockers.length === 0;
    const stopAtr = extra.stopDistance !== undefined ? extra.stopDistance / atr14 : Infinity;
    return deepFreeze({ allowed, level: allowed ? riskLevelFor(stopAtr, policy) : "BLOCKED", atr14, ...extra, reasons: allowed ? ["Structural risk within policy"] : reasons, blockers });
  };

  if (!Number.isFinite(atr14) || atr14 <= 0) {
    block("INVALID_ATR", "ATR14 unavailable; risk cannot be measured");
    return done();
  }
  if (!input.level) {
    block("NO_LEVEL", "No reclaimed level to anchor risk");
    return done();
  }
  const zone = entryZone(side, input.level.price, atr14, policy);
  const entry = (zone.min + zone.max) / 2;

  const inv = input.invalidation;
  if (inv === undefined || !Number.isFinite(inv) || d * (inv - (side === "BULLISH" ? zone.min : zone.max)) >= 0) {
    block("NO_INVALIDATION", "No explicit structural invalidation beyond the entry zone");
    return done({ entryZone: zone });
  }
  const stopDistance = Math.abs(entry - inv);

  const edge = side === "BULLISH" ? zone.max : zone.min;
  const target = input.levels
    .filter((l) => l.confirmed && l.id !== input.level?.id && !input.brokenLevelIds?.has(l.id) && d * (l.price - edge) > 0)
    .sort((a, b) => d * (a.price - b.price) || (a.id < b.id ? -1 : 1))[0];

  if (stopDistance / atr14 > policy.maximumStopAtr) block("STOP_TOO_WIDE", "Required stop is excessive relative to ATR");
  if (d * (input.currentPrice - edge) > policy.maximumExtensionAtr * atr14) block("PRICE_EXTENDED", "Price has extended beyond the entry zone");

  if (!target) {
    block("NO_TARGET", "No valid target level beyond the entry zone");
    return done({ entryZone: zone, invalidation: inv, stopDistance });
  }
  const reward = Math.abs(target.price - entry);
  const rewardRiskRatio = reward / stopDistance;
  if (rewardRiskRatio < policy.minimumRewardRiskRatio) block("INSUFFICIENT_REWARD_RISK", "Insufficient reward relative to structural risk");

  return done({ entryZone: zone, invalidation: inv, stopDistance, target: target.price, targetLevelId: target.id, rewardRiskRatio });
}
