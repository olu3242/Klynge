import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Direction, TechnicalState } from "../domain/types.ts";
import { DEFAULT_DATA_QUALITY_POLICY } from "../policies/data-quality-policy.ts";
import { evaluateRegime, regimeFromDirections } from "./regime-engine.ts";

const T = 1_772_470_500_000;
const tech = (dir: Direction, o: Partial<TechnicalState> = {}): TechnicalState => {
  const shape =
    dir === "BULLISH" ? { price: 105, vwap: 100, ema9: 103, ema9Slope: 0.5, structure: "HH_HL" as const }
    : dir === "BEARISH" ? { price: 95, vwap: 100, ema9: 97, ema9Slope: -0.5, structure: "LH_LL" as const }
    : { price: 100, vwap: 100, ema9: 100, ema9Slope: 0, structure: "MIXED" as const };
  return { symbol: "X", timeframe: "5m", timestamp: T, atr14: 1, volume: 1, averageVolume20: 1, volumeRatio: 1, ...shape, ...o };
};

const DIRS: Direction[] = ["BULLISH", "BEARISH", "NEUTRAL"];

describe("regime engine", () => {
  it("BULLISH / BULLISH => RISK_ON, aligned", () => {
    const r = evaluateRegime(tech("BULLISH"), tech("BULLISH"));
    assert.equal(r.regime, "RISK_ON");
    assert.equal(r.aligned, true);
    assert.deepEqual(r.blockers, []);
  });
  it("BEARISH / BEARISH => RISK_OFF, aligned", () => {
    const r = evaluateRegime(tech("BEARISH"), tech("BEARISH"));
    assert.equal(r.regime, "RISK_OFF");
    assert.equal(r.aligned, true);
  });
  for (const a of DIRS) {
    for (const b of DIRS) {
      if (a === b && a !== "NEUTRAL") continue;
      it(`${a} / ${b} => MIXED, not aligned`, () => {
        const r = evaluateRegime(tech(a), tech(b));
        assert.equal(r.regime, "MIXED");
        assert.equal(r.aligned, false);
        assert.ok(r.blockers.includes("MIXED_REGIME"));
        assert.equal(r.spx, a);
        assert.equal(r.mnq, b);
      });
    }
  }
  it("timestamp skew => UNKNOWN, not aligned (checked before directions)", () => {
    const skew = DEFAULT_DATA_QUALITY_POLICY.maxMarketSnapshotSkewMs;
    const r = evaluateRegime(tech("BULLISH"), tech("BULLISH", { timestamp: T + skew + 1 }));
    assert.equal(r.regime, "UNKNOWN");
    assert.equal(r.aligned, false);
    assert.ok(r.blockers.includes("TIMESTAMP_SKEW"));
    assert.ok(r.blockers.includes("UNKNOWN_REGIME"));
  });
  it("skew in either direction", () => {
    assert.equal(evaluateRegime(tech("BEARISH", { timestamp: T + 120_000 }), tech("BEARISH")).regime, "UNKNOWN");
  });
  it("skew exactly at the limit is allowed", () => {
    assert.equal(evaluateRegime(tech("BULLISH"), tech("BULLISH", { timestamp: T + 60_000 })).regime, "RISK_ON");
  });
  it("skew threshold is configurable", () => {
    const policy = { ...DEFAULT_DATA_QUALITY_POLICY, maxMarketSnapshotSkewMs: 0 };
    assert.equal(evaluateRegime(tech("BULLISH"), tech("BULLISH", { timestamp: T + 1 }), policy).regime, "UNKNOWN");
  });
  it("non-finite timestamps => UNKNOWN", () => {
    const r = evaluateRegime(tech("BULLISH", { timestamp: NaN }), tech("BULLISH"));
    assert.equal(r.regime, "UNKNOWN");
    assert.equal(r.aligned, false);
  });
  it("mismatched timeframes => UNKNOWN", () => {
    const r = evaluateRegime(tech("BULLISH"), tech("BULLISH", { timeframe: "1m" }));
    assert.equal(r.regime, "UNKNOWN");
    assert.equal(r.aligned, false);
  });
  it("every MIXED/UNKNOWN is unaligned (exhaustive)", () => {
    for (const a of DIRS) for (const b of DIRS) {
      const m = regimeFromDirections(a, b);
      if (m.regime === "MIXED" || m.regime === "UNKNOWN") assert.equal(m.aligned, false);
    }
  });
  it("output is frozen", () => assert.ok(Object.isFrozen(evaluateRegime(tech("BULLISH"), tech("BULLISH")))));
});
