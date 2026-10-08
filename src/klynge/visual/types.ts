import type { MarketStructure, Timeframe } from "../domain/types.ts";

/**
 * Field provenance. Extractors may only emit OBSERVED or NOT_VISIBLE. USER_CONFIRMED never becomes
 * DATA_VERIFIED; DATA_VERIFIED exists only for fields derived from OHLCV by the engine.
 */
export type Provenance = "DATA_VERIFIED" | "OBSERVED" | "USER_CONFIRMED" | "NOT_VISIBLE" | "NOT_PROVIDED" | "NOT_VERIFIED";

export const USABLE_PROVENANCE: readonly Provenance[] = Object.freeze(["DATA_VERIFIED", "OBSERVED", "USER_CONFIRMED"]);
export const isUsable = (p: Provenance) => USABLE_PROVENANCE.includes(p);

export type ChartRole = "TARGET" | "SPX" | "MNQ" | "VOLUME_PROXY";
export type PriceRelation = "ABOVE" | "BELOW" | "AT";
export type VisibleLevelKind = "SUPPORT" | "RESISTANCE";
export type VolumeVisibility = "FULL" | "PARTIAL" | "NONE";

export interface VisibleLevel {
  price: number;
  kind: VisibleLevelKind;
}

/** One observed claim: value + provenance + confidence (0–1) + the visible cue it rests on. */
export interface ObservedField<T> {
  value: T | null;
  status: Provenance;
  confidence: number;
  evidence: string;
}

/**
 * What a chart image can support. Deliberately ABSENT: ATR14, relative-volume baseline, exact EMA/VWAP values
 * (only relations, and only when visibly labelled). Those require DATA mode.
 */
export interface ChartObservation {
  symbol: ObservedField<string>;
  timeframe: ObservedField<Timeframe>;
  lastPrice: ObservedField<number>;
  priceAxisRange: ObservedField<{ min: number; max: number }>;
  vwapVisible: ObservedField<boolean>;
  priceVsVwap: ObservedField<PriceRelation>;
  /** Only when a labelled EMA is visible on the chart. */
  emaRelation: ObservedField<{ label: string; relation: PriceRelation }>;
  structure: ObservedField<MarketStructure>;
  levels: ObservedField<VisibleLevel[]>;
  volumeVisibility: ObservedField<VolumeVisibility>;
  /** Epoch ms of the latest visible bar, only when the time axis is legible. */
  chartTime: ObservedField<number>;
}

export type ObservationField = keyof ChartObservation;

export const OBSERVATION_FIELDS: readonly ObservationField[] = Object.freeze([
  "symbol",
  "timeframe",
  "lastPrice",
  "priceAxisRange",
  "vwapVisible",
  "priceVsVwap",
  "emaRelation",
  "structure",
  "levels",
  "volumeVisibility",
  "chartTime",
]);

/** Fields required for a visual context per chart role. */
export const REQUIRED_FIELDS: Readonly<Record<ChartRole, readonly ObservationField[]>> = Object.freeze({
  TARGET: ["symbol", "timeframe", "lastPrice", "priceVsVwap", "structure"],
  SPX: ["symbol", "timeframe", "priceVsVwap", "structure"],
  MNQ: ["symbol", "timeframe", "priceVsVwap", "structure"],
  VOLUME_PROXY: ["symbol"],
});

export const REQUIRED_ROLES: readonly ChartRole[] = Object.freeze(["TARGET", "SPX", "MNQ"]);

export interface VisualPolicy {
  /** OBSERVED claims below this confidence become NOT_VERIFIED. */
  minimumConfidence: number;
  /** Max spread of capture times across the chart set (mirrors TIMESTAMP_SKEW). */
  maxChartSetSkewMs: number;
  /** Max age of the newest chart at evaluation time. */
  maxChartAgeMs: number;
}

/** PROVISIONAL defaults. */
export const DEFAULT_VISUAL_POLICY: Readonly<VisualPolicy> = Object.freeze({
  minimumConfidence: 0.7,
  maxChartSetSkewMs: 5 * 60_000,
  maxChartAgeMs: 15 * 60_000,
});

export function notProvided<T>(): ObservedField<T> {
  return { value: null, status: "NOT_PROVIDED", confidence: 0, evidence: "" };
}
