import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PriceActionLifecycle } from "../price-action/types.ts";
import { evaluateConfirmation } from "./confirmation.ts";

const lc = (o: Partial<PriceActionLifecycle> = {}): PriceActionLifecycle => ({
  levelId: "L", levelPrice: 100, side: "BULLISH", state: "BROKEN", startedAt: 1, breakIndex: 1, acceptanceCloses: 0, transitions: [], ...o,
});
const ok = { marketPermissionEnabled: true, targetAligned: true, levelValid: true };
const full = lc({ state: "CONFIRMED", acceptedAt: 2, retestStartedAt: 3, continuationIndex: 4, confirmedAt: 4, invalidation: 99.5 });

describe("confirmation engine", () => {
  it("no lifecycle => PENDING", () => assert.equal(evaluateConfirmation(ok).state, "PENDING"));
  it("accepted, no retest => PENDING", () => assert.equal(evaluateConfirmation({ ...ok, lifecycle: lc({ state: "ACCEPTED", acceptedAt: 2 }) }).state, "PENDING"));
  it("retest, no continuation => PARTIAL", () => {
    const r = evaluateConfirmation({ ...ok, lifecycle: lc({ state: "RETESTING", acceptedAt: 2, retestStartedAt: 3 }) });
    assert.equal(r.state, "PARTIAL");
    assert.deepEqual(r.missing, ["Continuation close"]);
  });
  it("full sequence => CONFIRMED", () => assert.equal(evaluateConfirmation({ ...ok, lifecycle: full }).state, "CONFIRMED"));
  it("structural failure => FAILED", () => {
    assert.equal(evaluateConfirmation({ ...ok, lifecycle: lc({ state: "FAILED" }) }).state, "FAILED");
    assert.equal(evaluateConfirmation({ ...ok, lifecycle: { ...full, state: "INVALIDATED" } }).state, "FAILED");
  });
  for (const k of ["marketPermissionEnabled", "targetAligned", "levelValid"] as const) {
    it(`missing ${k} => not CONFIRMED (no voting)`, () => assert.notEqual(evaluateConfirmation({ ...ok, [k]: false, lifecycle: full }).state, "CONFIRMED"));
  }
  describe("volume grades quality, never gates structure", () => {
    const q = (ratio: number | null) => evaluateConfirmation({ ...ok, lifecycle: full, continuationVolumeRatio: ratio });
    it("weak volume still CONFIRMED / STANDARD", () => assert.deepEqual([q(0.5).state, q(0.5).quality], ["CONFIRMED", "STANDARD"]));
    it("1.19 => STANDARD", () => assert.equal(q(1.19).quality, "STANDARD"));
    it("1.20 => HIGH", () => assert.equal(q(1.2).quality, "HIGH"));
    it("1.50 => HIGH", () => assert.equal(q(1.5).quality, "HIGH"));
    it("unknown volume => STANDARD", () => assert.equal(q(null).quality, "STANDARD"));
  });
});
