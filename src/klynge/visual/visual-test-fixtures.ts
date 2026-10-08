import type { ChartObservation, ObservedField } from "./types.ts";
import { addChart } from "./session.ts";
import type { ChartSession } from "./session.ts";
import { validateObservation } from "./validator.ts";

export const T = 1_780_000_000_000;
type Raw = Record<string, Partial<ObservedField<unknown>> | undefined>;

const o = (value: unknown, confidence = 0.9): ObservedField<unknown> => ({ value, status: "OBSERVED", confidence, evidence: "visible" });
const nv = (): ObservedField<unknown> => ({ value: null, status: "NOT_VISIBLE", confidence: 0.9, evidence: "" });

/** Raw extractor-shaped output for a chart (bullish by default). */
export function raw(symbol: string, dir: "BULLISH" | "BEARISH" | "NEUTRAL" = "BULLISH", over: Raw = {}): Raw {
  const rel = dir === "BULLISH" ? "ABOVE" : dir === "BEARISH" ? "BELOW" : "AT";
  return {
    symbol: o(symbol),
    timeframe: o("5m"),
    lastPrice: o(100),
    priceAxisRange: o({ min: 90, max: 110 }),
    vwapVisible: o(true),
    priceVsVwap: o(rel),
    emaRelation: nv(),
    structure: o(dir === "BULLISH" ? "HH_HL" : dir === "BEARISH" ? "LH_LL" : "MIXED"),
    levels: nv(),
    volumeVisibility: o("NONE"),
    chartTime: nv(),
    ...over,
  };
}

export const observation = (r: Raw): ChartObservation => validateObservation(r).observation;

export function session(charts: { r: Raw; at?: number; role?: "TARGET" | "SPX" | "MNQ" | "VOLUME_PROXY"; id?: string }[]): ChartSession {
  let s: ChartSession = { sessionId: "s1", tenantId: "t1", createdAt: T, charts: [] };
  charts.forEach((c, i) => {
    s = addChart(s, { chartId: c.id ?? `c${i}`, observation: observation(c.r), issues: [], uploadedAt: c.at ?? T, ...(c.role ? { roleOverride: c.role } : {}) });
  });
  return s;
}

export const full = (target: "BULLISH" | "BEARISH" | "NEUTRAL", spx: "BULLISH" | "BEARISH" | "NEUTRAL", mnq: "BULLISH" | "BEARISH" | "NEUTRAL") =>
  session([{ r: raw("TSLA", target) }, { r: raw("SPX", spx) }, { r: raw("MNQ", mnq) }]);
