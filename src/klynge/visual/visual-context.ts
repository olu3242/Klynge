import { mergeUnique } from "../domain/blockers.ts";
import { deepFreeze } from "../domain/freeze.ts";
import type { Direction, MarketRegime } from "../domain/types.ts";
import { provenance } from "../engine/version.ts";
import type { DecisionProvenance } from "../engine/version.ts";
import { regimeFromDirections } from "../regime/regime-engine.ts";
import { missingContext } from "./missing-context.ts";
import { chartFor } from "./session.ts";
import type { ChartSession } from "./session.ts";
import { DEFAULT_VISUAL_POLICY, isUsable, OBSERVATION_FIELDS } from "./types.ts";
import type { ChartObservation, ChartRole, VisualPolicy } from "./types.ts";

export type VisualContextLabel = "BULLISH CONTEXT" | "BEARISH CONTEXT" | "MIXED CONTEXT" | "INSUFFICIENT CONTEXT";
export type VisualPermission = "WAIT" | "BLOCKED";

export const VISUAL_VERIFICATION_NOTICE = "Conditions observed — data verification required";

export interface VisualContextState {
  evidenceMode: "VISUAL";
  sessionId: string;
  timestamp: number;
  targetSymbol: string | null;
  /** Overall (target + broad market). Never a setup. */
  label: VisualContextLabel;
  /** Target chart alone, as observed. */
  targetContext: VisualContextLabel;
  /** Visual mode tops out at WAIT. */
  permission: VisualPermission;
  regime: MarketRegime;
  directions: { role: ChartRole; direction: Direction }[];
  observed: string[];
  notVerified: string[];
  missing: string[];
  nextSteps: string[];
  reasons: string[];
  blockers: string[];
  notice: typeof VISUAL_VERIFICATION_NOTICE;
  provenance: DecisionProvenance;
}

/**
 * Strict visual direction over the evidence an image can support (mirrors the strict data rule):
 *   BULLISH ⇔ price ABOVE VWAP ∧ structure HH_HL ∧ (no usable labelled EMA, or price ABOVE it); BEARISH mirrored.
 */
export function visualDirection(o: ChartObservation): Direction {
  const vwap = isUsable(o.priceVsVwap.status) ? o.priceVsVwap.value : null;
  const structure = isUsable(o.structure.status) ? o.structure.value : null;
  const ema = isUsable(o.emaRelation.status) ? o.emaRelation.value?.relation : undefined;
  if (vwap === "ABOVE" && structure === "HH_HL" && (ema === undefined || ema === "ABOVE")) return "BULLISH";
  if (vwap === "BELOW" && structure === "LH_LL" && (ema === undefined || ema === "BELOW")) return "BEARISH";
  return "NEUTRAL";
}

const labelFor = (d: Direction): VisualContextLabel => (d === "BULLISH" ? "BULLISH CONTEXT" : d === "BEARISH" ? "BEARISH CONTEXT" : "MIXED CONTEXT");

/**
 * Deterministic VISUAL context. Uses the canonical regime table on observed SPX/MNQ directions.
 * Missing/unverified required context => INSUFFICIENT CONTEXT + WAIT; timing or role violations,
 * MIXED regime or target/regime conflict => BLOCKED. It never produces CALL_SETUP / PUT_SETUP.
 */
export function evaluateVisualContext(session: ChartSession, now: number, policy: VisualPolicy = DEFAULT_VISUAL_POLICY): Readonly<VisualContextState> {
  const report = missingContext(session);
  const target = chartFor(session, "TARGET");
  const blockers: string[] = [];
  const reasons: string[] = [];
  const block = (code: string, why: string) => {
    blockers.push(code);
    reasons.push(why);
  };

  for (const c of session.charts) if (c.roleViolation) block("ROLE_VIOLATION", c.roleViolation);
  const times = session.charts.map((c) => c.captureTime);
  if (times.length > 1 && Math.max(...times) - Math.min(...times) > policy.maxChartSetSkewMs) {
    block("TIMESTAMP_SKEW", "Charts were captured too far apart; timing NOT_VERIFIED. Re-capture them together.");
  }
  if (times.some((t) => t > now)) block("FUTURE_CAPTURE", "A chart capture time is after the evaluation time");
  else if (times.length > 0 && now - Math.max(...times) > policy.maxChartAgeMs) block("STALE_DATA", "Charts are too old to describe current conditions");

  const directions = (["TARGET", "SPX", "MNQ"] as const).flatMap((role) => {
    const c = chartFor(session, role);
    return c ? [{ role, direction: visualDirection(c.observation) }] : [];
  });
  const dir = (r: ChartRole) => directions.find((d) => d.role === r)?.direction;
  const targetDir = dir("TARGET");
  const targetContext: VisualContextLabel = target && report.fields.every((f) => f.role !== "TARGET") ? labelFor(targetDir ?? "NEUTRAL") : "INSUFFICIENT CONTEXT";

  const spx = dir("SPX");
  const mnq = dir("MNQ");
  const marketReady = spx !== undefined && mnq !== undefined && report.fields.every((f) => f.role === "TARGET");
  const regime: MarketRegime = marketReady ? regimeFromDirections(spx, mnq).regime : "UNKNOWN";

  let label: VisualContextLabel = "INSUFFICIENT CONTEXT";
  if (!report.complete) {
    reasons.push(report.charts.some((c) => !c.present) ? "Broad-market confirmation has not been provided" : "Required observations are missing or not verified");
  } else if (regime === "MIXED") {
    label = "MIXED CONTEXT";
    block("MIXED_REGIME", `Market divergence observed: SPX ${spx}, MNQ ${mnq}`);
  } else if ((regime === "RISK_ON" && targetDir === "BEARISH") || (regime === "RISK_OFF" && targetDir === "BULLISH")) {
    label = "MIXED CONTEXT";
    block("TARGET_REGIME_CONFLICT", "Target direction conflicts with the observed market regime");
  } else if (targetDir === "NEUTRAL") {
    label = "MIXED CONTEXT";
    reasons.push("Target direction is not clearly established on the chart");
  } else {
    label = labelFor(targetDir ?? "NEUTRAL");
    reasons.push(`Target ${targetDir}, market ${regime} (observed)`);
  }

  const observed: string[] = [];
  const notVerified: string[] = [];
  for (const c of session.charts) {
    for (const field of OBSERVATION_FIELDS) {
      const f = c.observation[field];
      if (isUsable(f.status)) observed.push(`${c.role}.${field} ${f.status === "USER_CONFIRMED" ? "(confirmed)" : "(observed)"}`);
      else if (f.status === "NOT_VERIFIED") notVerified.push(`${c.role}.${field}`);
    }
  }
  // Fields an image can never verify — always listed so the user knows what VISUAL mode lacks.
  notVerified.push("ATR14", "Relative-volume baseline", "Exact EMA/VWAP values", "Break/acceptance/retest sequence", "Reward-to-risk");

  return deepFreeze({
    evidenceMode: "VISUAL" as const,
    sessionId: session.sessionId,
    timestamp: now,
    targetSymbol: target && isUsable(target.observation.symbol.status) ? target.observation.symbol.value : null,
    label,
    targetContext,
    permission: blockers.length > 0 ? ("BLOCKED" as const) : ("WAIT" as const),
    regime,
    directions,
    observed,
    notVerified,
    missing: [...report.charts.filter((c) => !c.present).map((c) => `${c.role} chart`), ...report.fields.map((f) => `${f.role}.${f.field} (${f.status})`)],
    nextSteps: mergeUnique(report.nextSteps, blockers.includes("TIMESTAMP_SKEW") ? ["Re-capture all charts together"] : []),
    reasons: mergeUnique(reasons),
    blockers: mergeUnique(blockers),
    notice: VISUAL_VERIFICATION_NOTICE,
    provenance: provenance(now),
  });
}
