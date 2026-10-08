import { deepFreeze } from "../domain/freeze.ts";
import type { Direction, MarketRegime, TradePermission } from "../domain/types.ts";
import type { MarketTruthSnapshot } from "../engine/market-truth.ts";
import type { ConfirmationState } from "../confirmation/confirmation.ts";
import type { PriceActionState } from "../price-action/types.ts";
import { validateDecisionState } from "../triggers/invariants.ts";
import type { KlyngeDecision, KlyngeDecisionState } from "../triggers/types.ts";
import type { OptionsDecision, OptionsDecisionState } from "../options/types.ts";
import type { ReplayOutcome } from "../replay/types.ts";
import type { HigherTimeframeBias } from "../timeframe/bias.ts";
import type { MultiTimeframeState } from "../timeframe/multi-timeframe.ts";
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

/** Structured claims an agent makes about a setup decision (extracted before reaching a user). */
export interface AgentSetupClaim {
  agentId: AgentId;
  action: string;
  decision?: KlyngeDecision;
  priceActionState?: PriceActionState;
  confirmationState?: ConfirmationState;
  riskAllowed?: boolean;
}

/**
 * Agents may explain/monitor setup state but never transform it:
 * WAIT -> CALL/PUT, BLOCKED -> setup, INVALIDATED -> active are all violations. Forged directional states are rejected.
 */
export function checkAgentSetupClaim(state: KlyngeDecisionState, claim: AgentSetupClaim): AuthorityCheck {
  const v: string[] = [];
  if (!(AGENT_ALLOWED_ACTIONS as readonly string[]).includes(claim.action)) v.push(`action "${claim.action}" is not permitted for agents`);
  for (const issue of validateDecisionState(state)) v.push(`engine state is not a valid directional decision: ${issue}`);
  if (claim.decision !== undefined && claim.decision !== state.decision) v.push(`decision ${claim.decision} contradicts engine ${state.decision}`);
  if (claim.priceActionState !== undefined && claim.priceActionState !== state.priceActionState) {
    v.push(`price action ${claim.priceActionState} contradicts engine ${String(state.priceActionState)}`);
  }
  if (claim.confirmationState !== undefined && claim.confirmationState !== state.confirmationState) {
    v.push(`confirmation ${claim.confirmationState} contradicts engine ${String(state.confirmationState)}`);
  }
  if (claim.riskAllowed !== undefined && claim.riskAllowed !== (state.risk?.allowed ?? false)) v.push("risk claim contradicts engine");
  return { ok: v.length === 0, violations: v };
}

/** Agents may explain a multi-timeframe state; they may not change bias or override conflict / sync. */
export interface AgentBiasClaim {
  agentId: AgentId;
  action: string;
  bias?: HigherTimeframeBias;
  synchronized?: boolean;
}

export function checkAgentBiasClaim(state: MultiTimeframeState, claim: AgentBiasClaim): AuthorityCheck {
  const v: string[] = [];
  if (!(AGENT_ALLOWED_ACTIONS as readonly string[]).includes(claim.action)) v.push(`action "${claim.action}" is not permitted for agents`);
  if (claim.bias !== undefined && claim.bias !== state.bias) v.push(`bias ${claim.bias} contradicts engine ${state.bias}`);
  if (claim.synchronized !== undefined && claim.synchronized !== state.synchronized) v.push("synchronization claim contradicts engine");
  return { ok: v.length === 0, violations: v };
}

/** Agents may explain contract eligibility; they may not bypass liquidity rules or mint eligibility. */
export interface AgentOptionsClaim {
  agentId: AgentId;
  action: string;
  decision?: OptionsDecision;
  eligibleContracts?: string[];
}

export function checkAgentOptionsClaim(state: OptionsDecisionState, claim: AgentOptionsClaim): AuthorityCheck {
  const v: string[] = [];
  if (!(AGENT_ALLOWED_ACTIONS as readonly string[]).includes(claim.action)) v.push(`action "${claim.action}" is not permitted for agents`);
  const directional = state.underlyingDecision === "CALL_SETUP" || state.underlyingDecision === "PUT_SETUP";
  if (state.decision === "ELIGIBLE" && !directional) v.push("engine state claims eligibility without an underlying CALL_SETUP/PUT_SETUP");
  const side = state.underlyingDecision === "CALL_SETUP" ? "CALL" : "PUT";
  if (state.eligibleContracts.some((c) => c.type !== side)) v.push("engine state contains contracts against the underlying direction");
  if (claim.decision !== undefined && claim.decision !== state.decision) v.push(`options decision ${claim.decision} contradicts engine ${state.decision}`);
  const engineEligible = new Set(state.eligibleContracts.map((c) => c.symbol));
  for (const s of claim.eligibleContracts ?? []) if (!engineEligible.has(s)) v.push(`contract ${s} is not eligible per engine`);
  return { ok: v.length === 0, violations: v };
}

/** Replay outcomes are evaluation records; agents may summarize but never modify them. */
export interface AgentReplayClaim {
  agentId: AgentId;
  action: string;
  targetReached?: boolean;
  invalidationReached?: boolean;
  realizedRewardRisk?: number;
}

export function checkAgentReplayClaim(outcome: ReplayOutcome, claim: AgentReplayClaim): AuthorityCheck {
  const v: string[] = [];
  if (!(AGENT_ALLOWED_ACTIONS as readonly string[]).includes(claim.action)) v.push(`action "${claim.action}" is not permitted for agents`);
  if (claim.targetReached !== undefined && claim.targetReached !== outcome.targetReached) v.push("target claim contradicts replay");
  if (claim.invalidationReached !== undefined && claim.invalidationReached !== outcome.invalidationReached) v.push("invalidation claim contradicts replay");
  if (claim.realizedRewardRisk !== undefined && claim.realizedRewardRisk !== outcome.realizedRewardRisk) v.push("R claim contradicts replay");
  return { ok: v.length === 0, violations: v };
}
