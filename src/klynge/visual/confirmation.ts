import { deepFreeze } from "../domain/freeze.ts";
import { DEFAULT_MARKET_CONTEXT_POLICY } from "../policies/market-context-policy.ts";
import type { MarketContextPolicy } from "../policies/market-context-policy.ts";
import { assignRole, captureTimeOf } from "./session.ts";
import type { ChartEntry, ChartSession, ConfirmationAudit } from "./session.ts";
import type { ChartObservation, ObservationField, ObservedField } from "./types.ts";
import { checkFieldValue } from "./validator.ts";

export interface ConfirmationEdit {
  field: ObservationField;
  action: "CONFIRM" | "EDIT";
  /** Required for EDIT. */
  value?: unknown;
}

export class ConfirmationError extends Error {
  override readonly name = "ConfirmationError";
}

/**
 * Human confirmation. CONFIRM accepts the observed value; EDIT replaces it. Both yield USER_CONFIRMED —
 * never DATA_VERIFIED. Every change is appended to an immutable audit trail (original vs confirmed, who, when).
 */
export function applyConfirmation(entry: ChartEntry, edit: ConfirmationEdit, actor: string, at: number, policy: MarketContextPolicy = DEFAULT_MARKET_CONTEXT_POLICY): Readonly<ChartEntry> {
  const original = entry.observation[edit.field] as ObservedField<unknown>;
  const value = edit.action === "EDIT" ? edit.value : original.value;
  if (value === null || value === undefined) throw new ConfirmationError(`${edit.field}: nothing to confirm`);
  const bad = checkFieldValue(edit.field, value);
  if (bad) throw new ConfirmationError(`${edit.field}: ${bad}`);
  if (!actor.trim()) throw new ConfirmationError("actor required");

  const confirmed: ObservedField<unknown> = {
    value,
    status: "USER_CONFIRMED",
    confidence: edit.action === "CONFIRM" ? original.confidence : 1,
    evidence: edit.action === "CONFIRM" ? `user confirmed: ${original.evidence}`.slice(0, 200) : "user edit",
  };
  const observation = { ...entry.observation, [edit.field]: confirmed } as ChartObservation;
  const audit: ConfirmationAudit = { field: edit.field, action: edit.action, original, confirmed, actor, at };
  const keepUserRole = entry.roleSource === "USER" ? entry.role : undefined;
  const role = assignRole(observation, keepUserRole, policy);
  const next: ChartEntry = {
    chartId: entry.chartId,
    ...role,
    observation,
    issues: entry.issues,
    uploadedAt: entry.uploadedAt,
    ...captureTimeOf(observation, entry.uploadedAt),
    audit: [...entry.audit, audit],
  };
  return deepFreeze(next);
}

/** Apply a confirmation to the chart with `chartId` inside a session (immutable). */
export function confirmInSession(session: ChartSession, chartId: string, edit: ConfirmationEdit, actor: string, at: number, policy?: MarketContextPolicy): Readonly<ChartSession> {
  const entry = session.charts.find((c) => c.chartId === chartId);
  if (!entry) throw new ConfirmationError(`chart ${chartId} not in session`);
  const updated = applyConfirmation(entry, edit, actor, at, policy);
  return deepFreeze({ ...session, charts: session.charts.map((c) => (c.chartId === chartId ? updated : c)) });
}
