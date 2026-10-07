import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ABSOLUTE_BLOCKER_CATEGORIES } from "../domain/blockers.ts";
import type { DataQualityState, RegimeState } from "../domain/types.ts";
import { blockerCategories, isDirectionallyEligible, assertDirectionalEligibility, InvariantViolation } from "./invariants.ts";
import { evaluateTradePermission } from "./trade-permission.ts";

const goodDq = (): DataQualityState => ({
  valid: true, stale: false, missingCandles: false, timestampSkew: false, sufficientHistory: true,
  duplicateTimestamps: false, outOfOrder: false, malformedOHLC: false, negativeVolume: false, reasons: [], blockers: [],
});
const riskOn = (): RegimeState => ({ timestamp: 1, spx: "BULLISH", mnq: "BULLISH", aligned: true, regime: "RISK_ON", reasons: [], blockers: [] });
const riskOff = (): RegimeState => ({ timestamp: 1, spx: "BEARISH", mnq: "BEARISH", aligned: true, regime: "RISK_OFF", reasons: [], blockers: [] });
const mixed = (): RegimeState => ({ timestamp: 1, spx: "BULLISH", mnq: "BEARISH", aligned: false, regime: "MIXED", reasons: [], blockers: ["MIXED_REGIME"] });
const unknown = (): RegimeState => ({ timestamp: 1, spx: "NEUTRAL", mnq: "NEUTRAL", aligned: false, regime: "UNKNOWN", reasons: [], blockers: ["UNKNOWN_REGIME"] });

describe("evaluateTradePermission — enabled paths", () => {
  it("RISK_ON + good data => ENABLED", () => {
    const r = evaluateTradePermission(riskOn(), goodDq());
    assert.equal(r.permission, "ENABLED");
    assert.deepEqual(r.blockers, []);
    assert.ok(isDirectionallyEligible(r));
  });
  it("RISK_OFF + good data => ENABLED", () => {
    assert.equal(evaluateTradePermission(riskOff(), goodDq()).permission, "ENABLED");
  });
});

describe("evaluateTradePermission — every blocker", () => {
  const dqCases: [string, Partial<DataQualityState>, string][] = [
    ["invalid data", { valid: false, blockers: ["BAD_DATA"] }, "BAD_DATA"],
    ["invalid flag without blockers", { valid: false }, "BAD_DATA"],
    ["no data", { valid: false, sufficientHistory: false, blockers: ["NO_DATA"] }, "NO_DATA"],
    ["stale data", { stale: true }, "STALE_DATA"],
    ["missing candles", { missingCandles: true }, "MISSING_CANDLES"],
    ["timestamp skew", { timestampSkew: true }, "TIMESTAMP_SKEW"],
    ["insufficient history", { sufficientHistory: false }, "INSUFFICIENT_HISTORY"],
    ["duplicate timestamps", { duplicateTimestamps: true }, "DUPLICATE_TIMESTAMPS"],
    ["out-of-order timestamps", { outOfOrder: true }, "OUT_OF_ORDER"],
    ["malformed OHLC", { malformedOHLC: true }, "MALFORMED_OHLC"],
    ["negative volume", { negativeVolume: true }, "NEGATIVE_VOLUME"],
    ["blocker listed but valid=true (forged)", { blockers: ["STALE_DATA"] }, "STALE_DATA"],
  ];
  for (const regime of [riskOn, riskOff]) {
    for (const [name, patch, code] of dqCases) {
      it(`${regime().regime} + ${name} => BLOCKED (${code})`, () => {
        const r = evaluateTradePermission(regime(), { ...goodDq(), ...patch } as DataQualityState);
        assert.equal(r.permission, "BLOCKED");
        assert.ok(r.blockers.includes(code as never), `expected ${code} in ${r.blockers.join(",")}`);
        assert.equal(isDirectionallyEligible(r), false);
      });
    }
  }

  const regimeCases: [string, () => RegimeState, string][] = [
    ["MIXED regime", mixed, "MIXED_REGIME"],
    ["UNKNOWN regime", unknown, "UNKNOWN_REGIME"],
    ["regime not aligned", () => ({ ...riskOn(), aligned: false }), "REGIME_NOT_ALIGNED"],
    ["MIXED without blockers listed", () => ({ ...mixed(), blockers: [] }), "MIXED_REGIME"],
    ["MIXED claiming aligned", () => ({ ...mixed(), aligned: true, blockers: [] }), "MIXED_REGIME"],
    ["fabricated RISK_ON with NEUTRAL directions", () => ({ ...riskOn(), spx: "NEUTRAL" }), "INCONSISTENT_STATE"],
    ["fabricated RISK_OFF with BULLISH directions", () => ({ ...riskOff(), spx: "BULLISH", mnq: "BULLISH" }), "INCONSISTENT_STATE"],
    ["unrecognized regime label", () => ({ ...riskOn(), regime: "RISK_MAYBE" as never }), "UNKNOWN_REGIME"],
    ["regime carries blockers", () => ({ ...riskOn(), blockers: ["TIMESTAMP_SKEW"] }), "TIMESTAMP_SKEW"],
  ];
  for (const [name, make, code] of regimeCases) {
    it(`${name} + good data => BLOCKED (${code})`, () => {
      const r = evaluateTradePermission(make(), goodDq());
      assert.equal(r.permission, "BLOCKED");
      assert.ok(r.blockers.includes(code as never), `expected ${code} in ${r.blockers.join(",")}`);
    });
  }

  it("divergence blocks even with perfect data", () => {
    assert.equal(evaluateTradePermission(mixed(), goodDq()).permission, "BLOCKED");
  });
  it("result is frozen (cannot be flipped downstream)", () => {
    const r = evaluateTradePermission(mixed(), goodDq());
    assert.throws(() => {
      (r as { permission: string }).permission = "ENABLED";
    }, TypeError);
  });
  it("every BLOCKED result names at least one blocker", () => {
    const r = evaluateTradePermission(unknown(), { ...goodDq(), valid: false });
    assert.ok(r.blockers.length > 0);
    assert.ok(r.reasons.length > 0);
  });
});

describe("ABSOLUTE INVARIANT", () => {
  const categoryToInput: Record<(typeof ABSOLUTE_BLOCKER_CATEGORIES)[number], [RegimeState, DataQualityState]> = {
    NO_DATA: [riskOn(), { ...goodDq(), valid: false, sufficientHistory: false, blockers: ["NO_DATA"] }],
    STALE_DATA: [riskOn(), { ...goodDq(), valid: false, stale: true, blockers: ["STALE_DATA"] }],
    BAD_DATA: [riskOn(), { ...goodDq(), valid: false, blockers: ["BAD_DATA"] }],
    TIMESTAMP_SKEW: [riskOn(), { ...goodDq(), valid: false, timestampSkew: true, blockers: ["TIMESTAMP_SKEW"] }],
    INSUFFICIENT_HISTORY: [riskOn(), { ...goodDq(), valid: false, sufficientHistory: false, blockers: ["INSUFFICIENT_HISTORY"] }],
    MIXED_REGIME: [mixed(), goodDq()],
    UNKNOWN_REGIME: [unknown(), goodDq()],
  };
  for (const cat of ABSOLUTE_BLOCKER_CATEGORIES) {
    it(`${cat} => BLOCKED and never directionally eligible`, () => {
      const [regime, dq] = categoryToInput[cat];
      const r = evaluateTradePermission(regime, dq);
      assert.equal(r.permission, "BLOCKED");
      assert.ok(blockerCategories(r).includes(cat));
      assert.equal(isDirectionallyEligible(r), false);
      assert.throws(() => assertDirectionalEligibility(r), InvariantViolation);
    });
  }
  it("a forged ENABLED carrying blockers is still ineligible", () => {
    assert.equal(isDirectionallyEligible({ permission: "ENABLED", reasons: [], blockers: ["STALE_DATA"] }), false);
  });
  it("assertDirectionalEligibility passes a genuine ENABLED", () => {
    assert.doesNotThrow(() => assertDirectionalEligibility(evaluateTradePermission(riskOn(), goodDq())));
  });
});
