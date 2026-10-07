import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TechnicalState } from "../domain/types.ts";
import { classifyDirection, evaluateDirection } from "./direction.ts";

const base = (o: Partial<TechnicalState>): TechnicalState => ({
  symbol: "SPX", timeframe: "5m", timestamp: 1, price: 100, vwap: 100, ema9: 100, ema9Slope: 0,
  atr14: 1, volume: 1, averageVolume20: 1, volumeRatio: 1, structure: "MIXED", ...o,
});

const BULL = base({ price: 105, vwap: 100, ema9: 103, ema9Slope: 0.5, structure: "HH_HL" });
const BEAR = base({ price: 95, vwap: 100, ema9: 97, ema9Slope: -0.5, structure: "LH_LL" });

describe("strict direction", () => {
  it("BULLISH when all four bullish conditions hold", () => assert.equal(classifyDirection(BULL), "BULLISH"));
  it("BEARISH when all four bearish conditions hold", () => assert.equal(classifyDirection(BEAR), "BEARISH"));

  const bullFails: [string, Partial<TechnicalState>][] = [
    ["price <= VWAP", { vwap: 105 }],
    ["price below VWAP", { vwap: 110 }],
    ["price <= EMA9", { ema9: 105 }],
    ["price below EMA9", { ema9: 110 }],
    ["EMA9 slope = 0", { ema9Slope: 0 }],
    ["EMA9 slope < 0", { ema9Slope: -0.1 }],
    ["structure MIXED", { structure: "MIXED" }],
    ["structure LH_LL", { structure: "LH_LL" }],
  ];
  for (const [name, patch] of bullFails) {
    it(`bullish fails independently on ${name} => NEUTRAL`, () => assert.equal(classifyDirection({ ...BULL, ...patch }), "NEUTRAL"));
  }

  const bearFails: [string, Partial<TechnicalState>][] = [
    ["price >= VWAP", { vwap: 95 }],
    ["price above VWAP", { vwap: 90 }],
    ["price >= EMA9", { ema9: 95 }],
    ["price above EMA9", { ema9: 90 }],
    ["EMA9 slope = 0", { ema9Slope: 0 }],
    ["EMA9 slope > 0", { ema9Slope: 0.1 }],
    ["structure MIXED", { structure: "MIXED" }],
    ["structure HH_HL", { structure: "HH_HL" }],
  ];
  for (const [name, patch] of bearFails) {
    it(`bearish fails independently on ${name} => NEUTRAL`, () => assert.equal(classifyDirection({ ...BEAR, ...patch }), "NEUTRAL"));
  }

  it("3 of 4 is never enough (no majority vote)", () => {
    const e = evaluateDirection({ ...BULL, structure: "MIXED" });
    assert.deepEqual(e.bullish, { priceVsVwap: true, priceVsEma9: true, ema9Slope: true, structure: false });
    assert.equal(e.direction, "NEUTRAL");
  });

  it("NaN inputs fail closed to NEUTRAL", () => {
    for (const k of ["price", "vwap", "ema9", "ema9Slope"] as const) {
      assert.equal(classifyDirection({ ...BULL, [k]: NaN }), "NEUTRAL");
      assert.equal(classifyDirection({ ...BEAR, [k]: NaN }), "NEUTRAL");
    }
  });
});
