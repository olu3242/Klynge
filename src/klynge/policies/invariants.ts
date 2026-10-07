import { ABSOLUTE_BLOCKER_CATEGORIES, BLOCKER_CATEGORY } from "../domain/blockers.ts";
import type { AbsoluteBlockerCategory } from "../domain/blockers.ts";
import type { TradePermissionResult } from "../domain/types.ts";

/**
 * ABSOLUTE INVARIANT
 *   NO_DATA | STALE_DATA | BAD_DATA | TIMESTAMP_SKEW | INSUFFICIENT_HISTORY | MIXED_REGIME | UNKNOWN_REGIME
 *   => BLOCKED, never downstream directional eligibility.
 *
 * Every downstream consumer (setup engine, options, alerts, agents) MUST gate on this function.
 */
export function isDirectionallyEligible(permission: TradePermissionResult): boolean {
  if (permission.permission !== "ENABLED") return false;
  if (permission.blockers.length > 0) return false;
  return true;
}

export function blockerCategories(permission: TradePermissionResult): AbsoluteBlockerCategory[] {
  const out: AbsoluteBlockerCategory[] = [];
  for (const b of permission.blockers) {
    const cat = BLOCKER_CATEGORY[b] ?? "BAD_DATA";
    if (!out.includes(cat)) out.push(cat);
  }
  return out;
}

export class InvariantViolation extends Error {
  override readonly name = "InvariantViolation";
}

/** Throw if a result claims ENABLED while carrying any absolute blocker. Use at every downstream boundary. */
export function assertDirectionalEligibility(permission: TradePermissionResult): void {
  if (!isDirectionallyEligible(permission)) {
    throw new InvariantViolation(`directional eligibility denied: ${blockerCategories(permission).join(", ") || "BLOCKED"}`);
  }
}

export { ABSOLUTE_BLOCKER_CATEGORIES };
