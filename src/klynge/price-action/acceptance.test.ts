import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ABOVE, BELOW, BREAK, mirror, P, run } from "./pa-test-helpers.ts";
import type { OHLC } from "./pa-test-helpers.ts";

const SLIGHTLY_BELOW: OHLC = [100.5, 100.5, 99.75, 99.875]; // close 0.125 below: not material
const MATERIAL_FAIL: OHLC = [100.5, 100.5, 99.5, 99.75]; // close exactly 0.25 ATR below: material

describe("acceptance rule", () => {
  it("break alone => pending (BROKEN)", () => assert.equal(run([BELOW, BREAK]).state, "BROKEN"));
  it("break candle does not count toward acceptance", () => {
    const r = run([BELOW, BREAK, ABOVE]);
    assert.equal(r.state, "BROKEN");
    assert.equal(r.lifecycles[0]?.acceptanceCloses, 1);
  });
  it("required sustained closes => ACCEPTED", () => assert.equal(run([BELOW, BREAK, ABOVE, ABOVE]).state, "ACCEPTED"));
  it("requiredCloses is configurable", () => {
    const p3 = { ...P, acceptance: { ...P.acceptance, requiredCloses: 3 } };
    assert.equal(run([BELOW, BREAK, ABOVE, ABOVE], "BULLISH", p3).state, "BROKEN");
    assert.equal(run([BELOW, BREAK, ABOVE, ABOVE, ABOVE], "BULLISH", p3).state, "ACCEPTED");
  });
  it("closes must be consecutive (a non-material close back resets the count)", () => {
    const r = run([BELOW, BREAK, ABOVE, SLIGHTLY_BELOW, ABOVE]);
    assert.equal(r.state, "BROKEN");
    assert.equal(r.lifecycles[0]?.acceptanceCloses, 1);
  });
  it("break followed by material failure => FAILED", () => {
    const r = run([BELOW, BREAK, MATERIAL_FAIL]);
    assert.equal(r.state, "FAILED");
    assert.match(r.lifecycles[0]?.endReason ?? "", /Break failed/);
  });
  it("bearish: break only pending, sustained closes accepted, failure fails", () => {
    assert.equal(run(mirror([BELOW, BREAK]), "BEARISH").state, "BROKEN");
    assert.equal(run(mirror([BELOW, BREAK, ABOVE, ABOVE]), "BEARISH").state, "ACCEPTED");
    assert.equal(run(mirror([BELOW, BREAK, MATERIAL_FAIL]), "BEARISH").state, "FAILED");
  });
});
