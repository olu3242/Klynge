import { deepFreeze } from "../domain/freeze.ts";
import type { OptionsDecisionState } from "../options/types.ts";
import type { KlyngeDecisionState } from "../triggers/types.ts";

/**
 * User risk preferences. They may only RESTRICT eligibility for the user — never create, upgrade or override an
 * engine decision (WAIT/BLOCKED/INVALIDATED stay exactly as the engine produced them). No broker execution exists.
 */
export interface UserRiskPolicy {
  version: 1;
  /** Hypothetical notional cap per idea (currency); null = no cap. */
  maxCapitalExposure: number | null;
  /** Hypothetical loss tolerance per idea at the engine's invalidation (currency); null = no cap. */
  maxLossPerTrade: number | null;
  /** Canonical symbols the user wants to consider; null = any. */
  allowedInstruments: string[] | null;
  sessionPreference: "REGULAR_HOURS_ONLY" | "ANY";
  /** Options eligibility is shown only after the user acknowledges options risk. */
  optionsRiskAcknowledged: boolean;
}

export const DEFAULT_USER_RISK_POLICY: Readonly<UserRiskPolicy> = Object.freeze({ version: 1, maxCapitalExposure: null, maxLossPerTrade: null, allowedInstruments: null, sessionPreference: "ANY", optionsRiskAcknowledged: false });

const SYMBOL = /^[A-Z][A-Z0-9.^/_-]{0,11}$/;

export function validateUserRiskPolicy(input: unknown): { policy: UserRiskPolicy } | { errors: string[] } {
  const o = (input ?? {}) as Record<string, unknown>;
  const errors: string[] = [];
  const money = (k: string) => {
    const v = o[k];
    if (v === null || v === undefined) return null;
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > 1e12) errors.push(`${k} must be a positive amount or empty`);
    return typeof v === "number" ? v : null;
  };
  const maxCapitalExposure = money("maxCapitalExposure");
  const maxLossPerTrade = money("maxLossPerTrade");
  let allowedInstruments: string[] | null = null;
  if (o.allowedInstruments !== null && o.allowedInstruments !== undefined) {
    if (!Array.isArray(o.allowedInstruments) || o.allowedInstruments.length > 50 || !o.allowedInstruments.every((s) => typeof s === "string" && SYMBOL.test(s))) errors.push("allowedInstruments must be up to 50 valid symbols");
    else allowedInstruments = [...new Set(o.allowedInstruments as string[])].sort();
  }
  const sessionPreference = o.sessionPreference ?? "ANY";
  if (sessionPreference !== "ANY" && sessionPreference !== "REGULAR_HOURS_ONLY") errors.push("sessionPreference must be ANY or REGULAR_HOURS_ONLY");
  if (o.optionsRiskAcknowledged !== undefined && typeof o.optionsRiskAcknowledged !== "boolean") errors.push("optionsRiskAcknowledged must be true or false");
  if (maxCapitalExposure !== null && maxLossPerTrade !== null && maxLossPerTrade > maxCapitalExposure) errors.push("maxLossPerTrade cannot exceed maxCapitalExposure");
  if (errors.length) return { errors };
  return { policy: { version: 1, maxCapitalExposure, maxLossPerTrade, allowedInstruments, sessionPreference: sessionPreference as UserRiskPolicy["sessionPreference"], optionsRiskAcknowledged: o.optionsRiskAcknowledged === true } };
}

export type PolicyVetoCode = "INSTRUMENT_NOT_ALLOWED" | "SESSION_NOT_ALLOWED" | "LOSS_TOLERANCE_EXCEEDED" | "EXPOSURE_TOO_SMALL" | "RISK_UNAVAILABLE" | "OPTIONS_RISK_NOT_ACKNOWLEDGED";

export interface PolicyVeto {
  code: PolicyVetoCode;
  scope: "SETUP" | "OPTIONS";
  reason: string;
}

export interface UserPolicyVerdict {
  /** The engine decision, verbatim. A user policy never changes it. */
  engineDecision: KlyngeDecisionState["decision"];
  /** Whether the idea remains within the user's own preferences (only possible when the engine says CALL/PUT). */
  withinUserPolicy: boolean;
  optionsWithinUserPolicy: boolean;
  vetoes: PolicyVeto[];
  /** Largest hypothetical size that respects both caps (shares), when computable. Informational only. */
  hypotheticalMaxShares: number | null;
}

export function applyUserPolicy(input: { decision: KlyngeDecisionState; options?: OptionsDecisionState | null; policy: UserRiskPolicy; regularSession: boolean }): Readonly<UserPolicyVerdict> {
  const { decision, policy } = input;
  const directional = decision.decision === "CALL_SETUP" || decision.decision === "PUT_SETUP";
  if (!directional) {
    // Nothing to restrict: the engine already said WAIT / BLOCKED / INVALIDATED. Preferences can never upgrade it.
    return deepFreeze({ engineDecision: decision.decision, withinUserPolicy: false, optionsWithinUserPolicy: false, vetoes: [], hypotheticalMaxShares: null });
  }
  const vetoes: PolicyVeto[] = [];
  if (policy.allowedInstruments && !policy.allowedInstruments.includes(decision.symbol)) vetoes.push({ code: "INSTRUMENT_NOT_ALLOWED", scope: "SETUP", reason: `${decision.symbol} is not in your instrument list` });
  if (policy.sessionPreference === "REGULAR_HOURS_ONLY" && !input.regularSession) vetoes.push({ code: "SESSION_NOT_ALLOWED", scope: "SETUP", reason: "Outside your preferred regular trading hours" });
  let maxShares: number | null = null;
  const r = decision.risk;
  const entry = r?.entryZone ? (r.entryZone.min + r.entryZone.max) / 2 : undefined;
  if (policy.maxLossPerTrade !== null || policy.maxCapitalExposure !== null) {
    if (entry === undefined || r?.invalidation === undefined || Math.abs(entry - r.invalidation) <= 0) vetoes.push({ code: "RISK_UNAVAILABLE", scope: "SETUP", reason: "Risk levels are unavailable, so your limits cannot be checked" });
    else {
      const perShare = Math.abs(entry - r.invalidation);
      const byLoss = policy.maxLossPerTrade !== null ? Math.floor(policy.maxLossPerTrade / perShare) : Number.POSITIVE_INFINITY;
      const byExposure = policy.maxCapitalExposure !== null ? Math.floor(policy.maxCapitalExposure / entry) : Number.POSITIVE_INFINITY;
      if (byLoss < 1) vetoes.push({ code: "LOSS_TOLERANCE_EXCEEDED", scope: "SETUP", reason: "The distance to invalidation exceeds your loss tolerance" });
      if (byExposure < 1) vetoes.push({ code: "EXPOSURE_TOO_SMALL", scope: "SETUP", reason: "Your capital limit is below the instrument price" });
      maxShares = Number.isFinite(Math.min(byLoss, byExposure)) ? Math.max(0, Math.min(byLoss, byExposure)) : null;
    }
  }
  const setupOk = vetoes.length === 0;
  const optionsEligible = input.options?.decision === "ELIGIBLE";
  if (optionsEligible && !policy.optionsRiskAcknowledged) vetoes.push({ code: "OPTIONS_RISK_NOT_ACKNOWLEDGED", scope: "OPTIONS", reason: "Acknowledge options risk in your settings to see option eligibility" });
  return deepFreeze({
    engineDecision: decision.decision,
    withinUserPolicy: setupOk,
    optionsWithinUserPolicy: setupOk && optionsEligible && policy.optionsRiskAcknowledged,
    vetoes,
    hypotheticalMaxShares: maxShares,
  });
}
