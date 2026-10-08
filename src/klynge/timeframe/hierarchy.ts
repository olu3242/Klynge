import type { Timeframe } from "../domain/types.ts";
import { TIMEFRAME_MS } from "./timeframe.ts";

export type TimeframeRole = "MACRO" | "STRUCTURE" | "SETUP" | "EXECUTION" | "REFINEMENT";

/** Highest authority first. */
export const TIMEFRAME_ROLES: readonly TimeframeRole[] = Object.freeze(["MACRO", "STRUCTURE", "SETUP", "EXECUTION", "REFINEMENT"]);

export interface TimeframePolicy {
  macro: Timeframe;
  structure: Timeframe;
  setup: Timeframe;
  execution: Timeframe;
  refinement?: Timeframe;
}

export const DEFAULT_TIMEFRAME_POLICY: Readonly<TimeframePolicy> = Object.freeze({
  macro: "1d",
  structure: "1h",
  setup: "15m",
  execution: "5m",
  refinement: "1m",
});

export function roleTimeframe(policy: TimeframePolicy, role: TimeframeRole): Timeframe | undefined {
  switch (role) {
    case "MACRO":
      return policy.macro;
    case "STRUCTURE":
      return policy.structure;
    case "SETUP":
      return policy.setup;
    case "EXECUTION":
      return policy.execution;
    case "REFINEMENT":
      return policy.refinement;
  }
}

/** Roles present in the policy, highest authority first. */
export function activeRoles(policy: TimeframePolicy): TimeframeRole[] {
  return TIMEFRAME_ROLES.filter((r) => roleTimeframe(policy, r) !== undefined);
}

/** Finest timeframe in the policy: every other role is derived from it (one feed, no cross-feed disagreement). */
export function baseTimeframe(policy: TimeframePolicy): Timeframe {
  return policy.refinement ?? policy.execution;
}

/**
 * Valid hierarchy: strictly descending timeframes from MACRO to the finest role, and every intraday role an
 * integer multiple of the base timeframe. "1d" is a whole-session bucket and may only be used for MACRO/STRUCTURE.
 */
export function assertValidTimeframePolicy(policy: TimeframePolicy): void {
  const roles = activeRoles(policy);
  const base = TIMEFRAME_MS[baseTimeframe(policy)];
  for (let i = 1; i < roles.length; i++) {
    const higher = TIMEFRAME_MS[roleTimeframe(policy, roles[i - 1] as TimeframeRole) as Timeframe];
    const lower = TIMEFRAME_MS[roleTimeframe(policy, roles[i] as TimeframeRole) as Timeframe];
    if (!(higher > lower)) throw new RangeError(`TimeframePolicy: ${roles[i - 1]} must be a higher timeframe than ${roles[i]}`);
  }
  for (const role of roles) {
    const tf = roleTimeframe(policy, role) as Timeframe;
    if (tf === "1d" && role !== "MACRO" && role !== "STRUCTURE") throw new RangeError(`TimeframePolicy: 1d is only valid for MACRO/STRUCTURE (got ${role})`);
    if (tf !== "1d" && TIMEFRAME_MS[tf] % base !== 0) throw new RangeError(`TimeframePolicy: ${role} ${tf} is not a multiple of base ${baseTimeframe(policy)}`);
  }
}
