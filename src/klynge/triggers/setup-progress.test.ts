import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BULL_BARS } from "../setup-test-fixtures.ts";
import { evaluate } from "./trigger-test-helpers.ts";

const at = (n: number) => evaluate({ bars: BULL_BARS.slice(0, n) });

describe("setup progress", () => {
  it("before any test: market + level only, WAIT", () => {
    const r = at(22);
    assert.equal(r.decision, "WAIT");
    assert.equal(r.priceActionState, "WAITING");
    assert.equal(r.progress.marketTruth, true);
    assert.equal(r.progress.level, true);
    assert.equal(r.progress.break, false);
    assert.ok(r.explanation.missing.includes("Break"));
  });
  it("testing the level is not a break", () => {
    const r = at(23);
    assert.equal(r.priceActionState, "TESTING");
    assert.equal(r.progress.break, false);
  });
  it("break => acceptance pending", () => {
    const r = at(24);
    assert.deepEqual([r.decision, r.priceActionState], ["WAIT", "BROKEN"]);
    assert.equal(r.progress.break, true);
    assert.equal(r.progress.acceptance, false);
    assert.equal(r.explanation.summary, "Level broken; acceptance pending.");
  });
  it("accepted => retest pending", () => {
    const r = at(26);
    assert.deepEqual([r.decision, r.priceActionState, r.confirmationState], ["WAIT", "ACCEPTED", "PENDING"]);
    assert.equal(r.explanation.summary, "Break has been accepted; retest pending.");
    assert.ok(r.reasons.includes("Missing: Valid retest and continuation confirmation"));
  });
  it("retest => confirmation pending (PARTIAL)", () => {
    const r = at(27);
    assert.deepEqual([r.decision, r.priceActionState, r.confirmationState], ["WAIT", "RETESTING", "PARTIAL"]);
    assert.deepEqual(r.explanation.missing, ["Continuation confirmation", "Risk approval"]);
  });
  it("complete => every stage true", () => {
    const r = at(28);
    assert.equal(r.decision, "CALL_SETUP");
    assert.ok(Object.values(r.progress).every(Boolean));
    assert.deepEqual(r.explanation.missing, []);
  });
  it("lifecycle identity is stable across progressive evaluations", () => {
    const ids = [24, 26, 27, 28].map((n) => at(n).setup?.setupId);
    assert.equal(new Set(ids).size, 1);
  });
  it("every state explains what invalidates it", () => {
    for (const n of [22, 24, 26, 27, 28]) assert.ok(at(n).explanation.invalidatesIf.length > 0, `n=${n}`);
    assert.match(at(28).explanation.invalidatesIf[0] ?? "", /structural invalidation/);
  });
});
