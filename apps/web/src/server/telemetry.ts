import { createHash } from "node:crypto";

export type TelemetryEventName =
  | "chart.intake"
  | "chart.extraction"
  | "chart.confirmation"
  | "snapshot.built"
  | "decision.evaluated"
  | "rate.limited"
  | "auth.sign_in"
  | "auth.sign_out"
  | "session.promoted"
  | "data.cycle";

/** Allow-listed, non-sensitive attributes. Anything else (image bytes, notes, prices, raw ids) is dropped. */
const ALLOWED: Record<TelemetryEventName, readonly string[]> = {
  "chart.intake": ["mime", "width", "height", "bytes", "outcome"],
  "chart.extraction": ["provider", "outcome", "observedFields", "notVerifiedFields", "durationMs"],
  "chart.confirmation": ["field", "action"],
  "snapshot.built": ["evidenceMode", "charts"],
  "decision.evaluated": ["evidenceMode", "label", "permission", "decision", "blockers"],
  "rate.limited": ["retryAfterMs"],
  "auth.sign_in": ["method", "outcome"],
  "auth.sign_out": [],
  "session.promoted": ["charts"],
  "data.cycle": ["kind", "provider", "permission", "decision"],
};

export interface TelemetryEvent {
  name: TelemetryEventName;
  at: number;
  /** Pseudonymous tenant hash (never the raw id). */
  tenant: string;
  attrs: Record<string, string | number | boolean>;
}

export interface TelemetrySink {
  emit(e: TelemetryEvent): void;
}

export class MemoryTelemetrySink implements TelemetrySink {
  readonly events: TelemetryEvent[] = [];
  emit(e: TelemetryEvent) {
    this.events.push(e);
  }
}

export const consoleTelemetrySink: TelemetrySink = { emit: (e) => console.info(`[telemetry] ${JSON.stringify(e)}`) };

const tenantHash = (id: string) => createHash("sha256").update(`klynge-telemetry:${id}`).digest("hex").slice(0, 16);

/** Sanitize then emit. Values must be primitives; strings are truncated; disallowed keys are removed. */
export function track(sink: TelemetrySink, name: TelemetryEventName, tenantId: string, at: number, attrs: Record<string, unknown>): TelemetryEvent {
  const clean: Record<string, string | number | boolean> = {};
  for (const key of ALLOWED[name]) {
    const v = attrs[key];
    if (typeof v === "number" && Number.isFinite(v)) clean[key] = v;
    else if (typeof v === "boolean") clean[key] = v;
    else if (typeof v === "string") clean[key] = v.slice(0, 64);
    else if (Array.isArray(v) && v.every((x) => typeof x === "string")) clean[key] = v.join(",").slice(0, 128);
  }
  const event: TelemetryEvent = { name, at, tenant: tenantHash(tenantId), attrs: clean };
  sink.emit(event);
  return event;
}
