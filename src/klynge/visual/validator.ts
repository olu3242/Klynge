import { deepFreeze } from "../domain/freeze.ts";
import { isTimeframe } from "../timeframe/timeframe.ts";
import { DEFAULT_VISUAL_POLICY, OBSERVATION_FIELDS } from "./types.ts";
import type { ChartObservation, ObservationField, ObservedField, Provenance, VisualPolicy } from "./types.ts";

export const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.^/_-]{0,11}$/;
const RELATIONS = ["ABOVE", "BELOW", "AT"];
const STRUCTURES = ["HH_HL", "LH_LL", "MIXED"];
const fin = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Type/domain check for a single field value. Returns null when valid, otherwise the reason. */
export function checkFieldValue(field: ObservationField, v: unknown): string | null {
  switch (field) {
    case "symbol":
      return typeof v === "string" && SYMBOL_PATTERN.test(v) ? null : "symbol format invalid";
    case "timeframe":
      return isTimeframe(v) ? null : "timeframe not in the supported set";
    case "lastPrice":
      return fin(v) && v > 0 ? null : "price must be a positive number";
    case "priceAxisRange": {
      const r = v as { min?: unknown; max?: unknown } | null;
      return r && fin(r.min) && fin(r.max) && r.min > 0 && r.max > r.min ? null : "axis range invalid";
    }
    case "vwapVisible":
      return typeof v === "boolean" ? null : "must be boolean";
    case "priceVsVwap":
      return RELATIONS.includes(v as string) ? null : "relation invalid";
    case "emaRelation": {
      const e = v as { label?: unknown; relation?: unknown } | null;
      return e && typeof e.label === "string" && /EMA/i.test(e.label) && RELATIONS.includes(e.relation as string) ? null : "EMA relation requires a visible EMA label";
    }
    case "structure":
      return STRUCTURES.includes(v as string) ? null : "structure invalid";
    case "levels":
      return Array.isArray(v) && v.every((l) => l && fin(l.price) && l.price > 0 && (l.kind === "SUPPORT" || l.kind === "RESISTANCE")) ? null : "levels invalid";
    case "volumeVisibility":
      return v === "FULL" || v === "PARTIAL" || v === "NONE" ? null : "volume visibility invalid";
    case "chartTime":
      return Number.isSafeInteger(v) && (v as number) > 0 ? null : "chart time invalid";
  }
}

export interface ValidatedObservation {
  observation: ChartObservation;
  issues: string[];
}

/**
 * Deterministic validation of raw extractor output (untrusted). Extractors may only assert OBSERVED or
 * NOT_VISIBLE; everything doubtful becomes NOT_VERIFIED — never inferred, never upgraded.
 */
export function validateObservation(raw: unknown, policy: VisualPolicy = DEFAULT_VISUAL_POLICY): Readonly<ValidatedObservation> {
  const issues: string[] = [];
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  for (const key of Object.keys(src)) if (!(OBSERVATION_FIELDS as readonly string[]).includes(key)) issues.push(`unsupported field ignored: ${key}`);

  const out = {} as Record<ObservationField, ObservedField<unknown>>;
  for (const field of OBSERVATION_FIELDS) {
    const f = (src[field] ?? null) as Partial<ObservedField<unknown>> | null;
    const evidence = typeof f?.evidence === "string" ? f.evidence.slice(0, 200) : "";
    const confidence = fin(f?.confidence) && f.confidence >= 0 && f.confidence <= 1 ? f.confidence : 0;
    const set = (status: Provenance, value: unknown, why?: string) => {
      out[field] = { value: status === "NOT_VISIBLE" || status === "NOT_PROVIDED" ? null : value, status, confidence, evidence };
      if (why) issues.push(`${field}: ${why}`);
    };
    if (!f) set("NOT_PROVIDED", null);
    else if (f.status === "NOT_VISIBLE") set("NOT_VISIBLE", null);
    else if (f.status !== "OBSERVED") set("NOT_VERIFIED", f.value ?? null, `extractor cannot assert ${String(f.status)}`);
    else if (f.value === null || f.value === undefined) set("NOT_VERIFIED", null, "observed without a value");
    else if (!fin(f.confidence) || f.confidence < 0 || f.confidence > 1) set("NOT_VERIFIED", f.value, "confidence invalid");
    else {
      const bad = checkFieldValue(field, f.value);
      if (bad) set("NOT_VERIFIED", f.value, bad);
      else if (f.confidence < policy.minimumConfidence) set("NOT_VERIFIED", f.value, `confidence ${f.confidence} below ${policy.minimumConfidence}`);
      else set("OBSERVED", f.value);
    }
  }
  const observation = out as unknown as ChartObservation;
  crossCheck(observation, issues);
  return deepFreeze({ observation, issues });
}

/** Cross-field consistency. Only OBSERVED claims are downgraded; user-confirmed values are never overridden. */
export function crossCheck(o: ChartObservation, issues: string[]): void {
  const downgrade = (f: ObservedField<unknown>, field: string, why: string) => {
    if (f.status === "OBSERVED") {
      f.status = "NOT_VERIFIED";
      issues.push(`${field}: ${why}`);
    }
  };
  const price = o.lastPrice.value;
  const axis = o.priceAxisRange.value;
  if (price !== null && axis !== null && (price < axis.min || price > axis.max)) downgrade(o.lastPrice, "lastPrice", "outside the visible price axis");
  if (o.priceVsVwap.status === "OBSERVED" && o.vwapVisible.value !== true) downgrade(o.priceVsVwap, "priceVsVwap", "VWAP relation without a visible VWAP");
  if (price !== null && o.levels.value) {
    const misplaced = o.levels.value.some((l) => (l.kind === "SUPPORT" && l.price > price) || (l.kind === "RESISTANCE" && l.price < price));
    if (misplaced) downgrade(o.levels, "levels", "support above / resistance below the observed price");
  }
}
