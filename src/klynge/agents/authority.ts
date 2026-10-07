import { deepFreeze } from "../domain/freeze.ts";
import type { Direction, MarketRegime, TradePermission } from "../domain/types.ts";
import type { MarketTruthSnapshot } from "../engine/market-truth.ts";
import type { AgentId } from "./registry.ts";

/** DETERMINISTIC ENGINE -> AGENT -> USER. Lower index = higher authority over market truth. */
export const AUTHORITY_HIERARCHY = Object.freeze(["DETERMINISTIC_ENGINE", "AGENT", "USER"] as const);

export const AGENT_ALLOWED_ACTIONS = Object.freeze(["explain", "summarize", "monitor", "coordinate", "surface_changes"] as const);
export type AgentAction = (typeof AGENT_ALLOWED_ACTIONS)[number];

export const AGENT_FORBIDDEN_ACTIONS = Object.freeze([
  "fabricate_market_state",
  "override_mixed",
  "override_unknown",
  "bypass_blocked",
  "invent_market_data",
  "change_deterministic_result",
] as const);

/** Structured claims extracted from an agent's output before it reaches a user. */
export interface AgentClaim {
  agentId: AgentId;
  action: string;
  permission?: TradePermission;
  regime?: MarketRegime;
  spx?: Direction;
  mnq?: Direction;
}

export interface AuthorityCheck {
  ok: boolean;
  violations: string[];
}

/**
 * Validate an agent claim against the engine snapshot. Any disagreement is a violation;
 * the engine result always wins and the agent output must be discarded.
 */
export function checkAgentClaim(snapshot: MarketTruthSnapshot, claim: AgentClaim): AuthorityCheck {
  const v: string[] = [];
  if (!(AGENT_ALLOWED_ACTIONS as readonly string[]).includes(claim.action)) v.push(`action "${claim.action}" is not permitted for agents`);
  if (claim.permission !== undefined && claim.permission !== snapshot.permission.permission) {
    v.push(`permission ${claim.permission} contradicts engine ${snapshot.permission.permission}`);
  }
  if (claim.regime !== undefined && claim.regime !== snapshot.regime.regime) v.push(`regime ${claim.regime} contradicts engine ${snapshot.regime.regime}`);
  if (claim.spx !== undefined && claim.spx !== snapshot.regime.spx) v.push(`SPX ${claim.spx} contradicts engine ${snapshot.regime.spx}`);
  if (claim.mnq !== undefined && claim.mnq !== snapshot.regime.mnq) v.push(`MNQ ${claim.mnq} contradicts engine ${snapshot.regime.mnq}`);
  return { ok: v.length === 0, violations: v };
}

/** Agents receive a frozen, read-only view. Mutation attempts throw in strict mode. */
export function agentView(snapshot: MarketTruthSnapshot): Readonly<MarketTruthSnapshot> {
  return deepFreeze(snapshot);
}
