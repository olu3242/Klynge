import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ABOVE, BELOW, BREAK, mirror, run, WICK_ABOVE } from "./pa-test-helpers.ts";
import type { OHLC } from "./pa-test-helpers.ts";

describe("break rule", () => {
  it("wick above resistance => not BROKEN (TESTING)", () => {
    const r = run([BELOW, WICK_ABOVE]);
    assert.equal(r.state, "TESTING");
    assert.equal(r.lifecycles.length, 0);
  });
  it("close exactly at the ATR threshold => BROKEN", () => assert.equal(run([BELOW, BREAK]).state, "BROKEN"));
  it("close just short of the threshold => not BROKEN", () => {
    const short: OHLC = [99.75, 100.75, 99.5, 100.4999];
    assert.notEqual(run([BELOW, short]).state, "BROKEN");
  });
  it("touch is not a break", () => assert.equal(run([BELOW, [99.5, 99.875, 99.25, 99.5]]).state, "TESTING"));
  it("far below the level => WAITING", () => assert.equal(run([BELOW, BELOW]).state, "WAITING"));
  it("requires approach from the origin side (gap above is not a break)", () => {
    const r = run([ABOVE, ABOVE, ABOVE]);
    assert.equal(r.lifecycles.length, 0);
  });
  it("records lifecycle start at the break candle", () => {
    const r = run([BELOW, BREAK]);
    assert.equal(r.lifecycles[0]?.startedAt, 1001);
    assert.equal(r.lifecycles[0]?.breakIndex, 1);
  });
  it("threshold scales with policy", () => {
    assert.notEqual(run([BELOW, BREAK], "BULLISH", P_strict()).state, "BROKEN");
  });
  it("lifecycle cannot start when the level is not current", () => {
    assert.equal(run([BELOW, BREAK], "BULLISH", undefined, () => false).state, "TESTING");
  });

  describe("bearish equivalent", () => {
    it("wick below support => not BROKEN", () => assert.equal(run(mirror([BELOW, WICK_ABOVE]), "BEARISH").state, "TESTING"));
    it("close below threshold => BROKEN", () => assert.equal(run(mirror([BELOW, BREAK]), "BEARISH").state, "BROKEN"));
    it("close just short => not BROKEN", () => assert.notEqual(run(mirror([BELOW, [99.75, 100.75, 99.5, 100.4999]]), "BEARISH").state, "BROKEN"));
  });
});

function P_strict() {
  return { break: { minimumCloseDistanceAtr: 1 }, acceptance: { requiredCloses: 2, maximumFailureDistanceAtr: 0.25 }, retest: { toleranceAtr: 0.25, maximumDepthAtr: 0.5 }, touchToleranceAtr: 0.25, invalidationToleranceAtr: 0.25 };
}
