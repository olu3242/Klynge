import { deepFreeze } from "../domain/freeze.ts";
import { DEFAULT_MARKET_CONTEXT_POLICY } from "../policies/market-context-policy.ts";
import type { MarketContextPolicy } from "../policies/market-context-policy.ts";
import { isUsable } from "./types.ts";
import type { ChartObservation, ChartRole, ObservationField, ObservedField } from "./types.ts";

export interface ConfirmationAudit {
  field: ObservationField;
  action: "CONFIRM" | "EDIT";
  original: ObservedField<unknown>;
  confirmed: ObservedField<unknown>;
  actor: string;
  at: number;
}

export interface ChartEntry {
  /** Deterministic id supplied by the intake layer (e.g. content hash). */
  chartId: string;
  role: ChartRole;
  roleSource: "DETECTED" | "USER";
  /** Set when the chart's symbol cannot legally fill its role. */
  roleViolation?: string;
  observation: ChartObservation;
  issues: string[];
  uploadedAt: number;
  captureTime: number;
  captureTimeSource: "UPLOAD" | "AXIS_CONFIRMED";
  audit: ConfirmationAudit[];
}

export interface ChartSession {
  sessionId: string;
  tenantId: string;
  createdAt: number;
  charts: ChartEntry[];
}

/** Role implied by a symbol under the market-context policy (null = unknown symbol). */
export function roleForSymbol(symbol: string | null, policy: MarketContextPolicy = DEFAULT_MARKET_CONTEXT_POLICY): ChartRole | null {
  if (!symbol) return null;
  if (symbol === policy.broadMarketSymbol) return "SPX";
  if (symbol === policy.technologyConfirmationSymbol) return "MNQ";
  if (policy.volumeProxySymbol !== null && symbol === policy.volumeProxySymbol) return "VOLUME_PROXY";
  return "TARGET";
}

/** Detected role, optionally overridden by the user — validated against the market-context policy. */
export function assignRole(
  observation: ChartObservation,
  override: ChartRole | undefined,
  policy: MarketContextPolicy = DEFAULT_MARKET_CONTEXT_POLICY,
): Pick<ChartEntry, "role" | "roleSource"> & { roleViolation?: string } {
  const symbol = isUsable(observation.symbol.status) ? observation.symbol.value : null;
  const detected = roleForSymbol(symbol, policy);
  if (!override) return { role: detected ?? "TARGET", roleSource: "DETECTED" };
  if (detected !== null && detected !== override) {
    return { role: override, roleSource: "USER", roleViolation: `${symbol} cannot fill the ${override} role` };
  }
  return { role: override, roleSource: "USER" };
}

export function captureTimeOf(observation: ChartObservation, uploadedAt: number): Pick<ChartEntry, "captureTime" | "captureTimeSource"> {
  const t = observation.chartTime;
  return t.status === "USER_CONFIRMED" && typeof t.value === "number" ? { captureTime: t.value, captureTimeSource: "AXIS_CONFIRMED" } : { captureTime: uploadedAt, captureTimeSource: "UPLOAD" };
}

export interface AddChartInput {
  chartId: string;
  observation: ChartObservation;
  issues: string[];
  uploadedAt: number;
  roleOverride?: ChartRole;
}

/** Immutable add: one chart per role, the newest upload for a role replaces the previous one. */
export function addChart(session: ChartSession, input: AddChartInput, policy: MarketContextPolicy = DEFAULT_MARKET_CONTEXT_POLICY): Readonly<ChartSession> {
  const role = assignRole(input.observation, input.roleOverride, policy);
  const entry: ChartEntry = {
    chartId: input.chartId,
    ...role,
    observation: input.observation,
    issues: input.issues,
    uploadedAt: input.uploadedAt,
    ...captureTimeOf(input.observation, input.uploadedAt),
    audit: [],
  };
  return deepFreeze({ ...session, charts: [...session.charts.filter((c) => c.role !== entry.role && c.chartId !== entry.chartId), entry] });
}

export function chartFor(session: ChartSession, role: ChartRole): ChartEntry | undefined {
  return session.charts.find((c) => c.role === role);
}
