import { z } from "zod";
import type { ChartObservation } from "../engine-core.ts";

const status = z.enum(["OBSERVED", "NOT_VISIBLE"]);
const field = <T extends z.ZodType>(value: T) =>
  z.object({
    value: value.nullable(),
    status,
    confidence: z.number().min(0).max(1),
    evidence: z.string().max(200),
  });
const relation = z.enum(["ABOVE", "BELOW", "AT"]);

/**
 * Strict extractor output schema. Extractors may only claim OBSERVED or NOT_VISIBLE. There is intentionally no
 * field for ATR, relative-volume baseline or exact EMA/VWAP values — an image cannot support them.
 */
export const ChartObservationSchema = z.object({
  symbol: field(z.string()),
  timeframe: field(z.enum(["1m", "5m", "15m", "30m", "1h", "4h", "1d"])),
  lastPrice: field(z.number()),
  priceAxisRange: field(z.object({ min: z.number(), max: z.number() })),
  vwapVisible: field(z.boolean()),
  priceVsVwap: field(relation),
  emaRelation: field(z.object({ label: z.string(), relation })),
  structure: field(z.enum(["HH_HL", "LH_LL", "MIXED"])),
  levels: field(z.array(z.object({ price: z.number(), kind: z.enum(["SUPPORT", "RESISTANCE"]) }))),
  volumeVisibility: field(z.enum(["FULL", "PARTIAL", "NONE"])),
  chartTime: field(z.number().int()),
});

export type ExtractedObservation = z.infer<typeof ChartObservationSchema>;

// Compile-time guarantee that the wire schema matches the engine's ChartObservation shape.
type Assert<T extends true> = T;
type Keys = Assert<keyof ExtractedObservation extends keyof ChartObservation ? (keyof ChartObservation extends keyof ExtractedObservation ? true : false) : false>;
export type _SchemaMatchesEngine = Keys;
