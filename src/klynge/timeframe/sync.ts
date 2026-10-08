import type { TimeframeRole } from "./hierarchy.ts";
import { TIMEFRAME_MS } from "./timeframe.ts";

export interface TimeframeSyncPolicy {
  /** Max age (ms) of a role's last CLOSED candle (now − candle close). Missing roles use the defaults. */
  maxAgeByRole: Partial<Record<TimeframeRole, number>>;
}

const GRACE = 60_000;
const FOUR_DAYS = 4 * 24 * 60 * 60_000;

/**
 * PROVISIONAL defaults. Higher-timeframe context (MACRO/STRUCTURE) remains valid across the overnight /
 * weekend gap while lower timeframes update; SETUP/EXECUTION/REFINEMENT must be from the current interval.
 * Completeness of every closed bucket is enforced separately (resampler) — this is the wall-clock cap.
 */
export const DEFAULT_TIMEFRAME_SYNC_POLICY: Readonly<TimeframeSyncPolicy> = Object.freeze({
  maxAgeByRole: Object.freeze({
    MACRO: FOUR_DAYS,
    STRUCTURE: FOUR_DAYS,
    SETUP: TIMEFRAME_MS["15m"] + GRACE,
    EXECUTION: TIMEFRAME_MS["5m"] + GRACE,
    REFINEMENT: TIMEFRAME_MS["1m"] + GRACE,
  }),
});

export function maxAgeFor(role: TimeframeRole, policy: TimeframeSyncPolicy): number {
  return policy.maxAgeByRole[role] ?? DEFAULT_TIMEFRAME_SYNC_POLICY.maxAgeByRole[role] ?? GRACE;
}
