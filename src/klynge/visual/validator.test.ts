import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_VISUAL_POLICY } from "./types.ts";
import { validateObservation } from "./validator.ts";
import { raw } from "./visual-test-fixtures.ts";

const v = (r: unknown) => validateObservation(r);

describe("observation validator (extractor output is untrusted)", () => {
  it("clean observation stays OBSERVED", () => {
    const { observation, issues } = v(raw("TSLA"));
    assert.equal(observation.symbol.status, "OBSERVED");
    assert.equal(observation.structure.value, "HH_HL");
    assert.deepEqual(issues, []);
  });
  it("extractors cannot assert DATA_VERIFIED or USER_CONFIRMED", () => {
    for (const status of ["DATA_VERIFIED", "USER_CONFIRMED", "BOGUS"]) {
      assert.equal(v(raw("TSLA", "BULLISH", { lastPrice: { value: 100, status: status as never, confidence: 1, evidence: "" } })).observation.lastPrice.status, "NOT_VERIFIED");
    }
  });
  it("confidence below policy => NOT_VERIFIED; exactly at threshold => OBSERVED", () => {
    const at = DEFAULT_VISUAL_POLICY.minimumConfidence;
    assert.equal(v(raw("TSLA", "BULLISH", { structure: { value: "HH_HL", status: "OBSERVED", confidence: at - 0.01, evidence: "" } })).observation.structure.status, "NOT_VERIFIED");
    assert.equal(v(raw("TSLA", "BULLISH", { structure: { value: "HH_HL", status: "OBSERVED", confidence: at, evidence: "" } })).observation.structure.status, "OBSERVED");
  });
  it("invalid confidence, values and formats become NOT_VERIFIED (never coerced)", () => {
    const bad = v(
      raw("tsla lower", "BULLISH", {
        timeframe: { value: "2m", status: "OBSERVED", confidence: 0.9, evidence: "" },
        lastPrice: { value: -5, status: "OBSERVED", confidence: 0.9, evidence: "" },
        priceVsVwap: { value: "ABOVE", status: "OBSERVED", confidence: 1.5, evidence: "" },
      }),
    ).observation;
    assert.equal(bad.symbol.status, "NOT_VERIFIED");
    assert.equal(bad.timeframe.status, "NOT_VERIFIED");
    assert.equal(bad.lastPrice.status, "NOT_VERIFIED");
    assert.equal(bad.priceVsVwap.status, "NOT_VERIFIED");
  });
  it("NOT_VISIBLE never carries a value; OBSERVED without value => NOT_VERIFIED", () => {
    const o = v(raw("TSLA", "BULLISH", { chartTime: { value: 123, status: "NOT_VISIBLE", confidence: 0.9, evidence: "" }, structure: { value: null, status: "OBSERVED", confidence: 0.9, evidence: "" } })).observation;
    assert.equal(o.chartTime.value, null);
    assert.equal(o.structure.status, "NOT_VERIFIED");
  });
  it("fields an image cannot support are ignored, never accepted", () => {
    const { observation, issues } = v({ ...raw("TSLA"), atr14: { value: 4, status: "OBSERVED", confidence: 1, evidence: "" }, rvol: {} });
    assert.ok(issues.includes("unsupported field ignored: atr14"));
    assert.equal((observation as unknown as Record<string, unknown>).atr14, undefined);
  });
  it("EMA relation requires a visible EMA label", () => {
    assert.equal(v(raw("TSLA", "BULLISH", { emaRelation: { value: { label: "MA", relation: "ABOVE" }, status: "OBSERVED", confidence: 0.9, evidence: "" } })).observation.emaRelation.status, "NOT_VERIFIED");
    assert.equal(v(raw("TSLA", "BULLISH", { emaRelation: { value: { label: "EMA 9", relation: "ABOVE" }, status: "OBSERVED", confidence: 0.9, evidence: "" } })).observation.emaRelation.status, "OBSERVED");
  });
  it("cross-checks: price outside the axis, VWAP relation without VWAP, misplaced levels", () => {
    assert.equal(v(raw("TSLA", "BULLISH", { lastPrice: { value: 150, status: "OBSERVED", confidence: 0.99, evidence: "" } })).observation.lastPrice.status, "NOT_VERIFIED");
    assert.equal(v(raw("TSLA", "BULLISH", { vwapVisible: { value: false, status: "OBSERVED", confidence: 0.9, evidence: "" } })).observation.priceVsVwap.status, "NOT_VERIFIED");
    assert.equal(v(raw("TSLA", "BULLISH", { levels: { value: [{ price: 105, kind: "SUPPORT" }], status: "OBSERVED", confidence: 0.9, evidence: "" } })).observation.levels.status, "NOT_VERIFIED");
    assert.equal(v(raw("TSLA", "BULLISH", { levels: { value: [{ price: 95, kind: "SUPPORT" }, { price: 105, kind: "RESISTANCE" }], status: "OBSERVED", confidence: 0.9, evidence: "" } })).observation.levels.status, "OBSERVED");
  });
  it("no extractor output => every field NOT_PROVIDED", () => {
    for (const r of [null, undefined, "x", 42]) assert.ok(Object.values(v(r).observation).every((f) => f.status === "NOT_PROVIDED"));
  });
  it("is deterministic and frozen", () => {
    assert.deepEqual(v(raw("TSLA")), v(raw("TSLA")));
    assert.ok(Object.isFrozen(v(raw("TSLA")).observation.symbol));
  });
});
