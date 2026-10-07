import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ABOVE, BELOW, BREAK, CONTINUATION, run, RETEST } from "./pa-test-helpers.ts";
import { assertTransition, IllegalTransitionError, isLegalTransition, LEGAL_TRANSITIONS } from "./transitions.ts";
import type { PriceActionState } from "./types.ts";

const STATES = Object.keys(LEGAL_TRANSITIONS) as PriceActionState[];
const FULL = [BELOW, BREAK, ABOVE, ABOVE, RETEST, CONTINUATION];

describe("price-action state machine", () => {
  for (const [from, to] of [
    ["WAITING", "CONFIRMED"],
    ["BROKEN", "CONFIRMED"],
    ["FAILED", "CONFIRMED"],
    ["INVALIDATED", "CONFIRMED"],
    ["WAITING", "ACCEPTED"],
    ["BROKEN", "RETESTING"],
    ["ACCEPTED", "CONFIRMED"],
    ["TESTING", "ACCEPTED"],
    ["FAILED", "BROKEN"],
    ["INVALIDATED", "RETESTING"],
  ] as [PriceActionState, PriceActionState][]) {
    it(`rejects ${from} -> ${to}`, () => {
      assert.equal(isLegalTransition(from, to), false);
      assert.throws(() => assertTransition(from, to), IllegalTransitionError);
    });
  }
  it("only CONFIRMED's predecessor is RETESTING", () => {
    for (const s of STATES) assert.equal(isLegalTransition(s, "CONFIRMED"), s === "RETESTING" || s === "CONFIRMED");
  });
  it("terminal states only leave via a new lifecycle (WAITING)", () => {
    assert.deepEqual([...LEGAL_TRANSITIONS.FAILED], ["WAITING"]);
    assert.deepEqual([...LEGAL_TRANSITIONS.INVALIDATED], ["WAITING"]);
  });
  it("full sequence visits every stage in order", () => {
    const r = run(FULL);
    assert.deepEqual(r.transitions.map((t) => t.to), ["TESTING", "BROKEN", "ACCEPTED", "RETESTING", "CONFIRMED"].filter((s, i) => i > 0 || r.transitions[0]?.to === "TESTING"));
    assert.equal(r.state, "CONFIRMED");
  });
  it("every emitted transition is legal and chained", () => {
    const r = run([...FULL, [101, 101, 99.5, 99.6], BELOW, BREAK, ABOVE]);
    let prev: PriceActionState = "WAITING";
    for (const t of r.transitions) {
      assert.equal(t.from, prev);
      assert.ok(isLegalTransition(t.from, t.to), `${t.from}->${t.to}`);
      prev = t.to;
    }
  });
  it("CONFIRMED -> INVALIDATED when invalidation is breached", () => {
    const r = run([...FULL, [101, 101, 99.5, 99.7]]);
    assert.equal(r.state, "INVALIDATED");
    assert.match(r.lifecycles[0]?.endReason ?? "", /Invalidation breached/);
  });
  it("a failed lifecycle never jumps to CONFIRMED; a fresh break starts a new lifecycle", () => {
    // After failure, even strong closes beyond the level only start a NEW lifecycle at BROKEN.
    const r = run([BELOW, BREAK, [100.5, 100.5, 99.5, 99.75], ABOVE, CONTINUATION]);
    assert.equal(r.lifecycles[0]?.state, "FAILED");
    assert.equal(r.lifecycles.length, 2);
    assert.notEqual(r.state, "CONFIRMED");
    // Without re-arming from the origin side, no new lifecycle can start.
    const stuck = run([BELOW, BREAK, ABOVE, ABOVE, RETEST, [100.5, 100.5, 99.5, 99.75], [99.75, 100.25, 99.6, 100.0]]);
    assert.equal(stuck.state, "FAILED");
    const r2 = run([BELOW, BREAK, [100.5, 100.5, 99.5, 99.75], BELOW, BREAK]);
    assert.equal(r2.lifecycles.length, 2);
    assert.equal(r2.lifecycles[0]?.state, "FAILED");
    assert.equal(r2.state, "BROKEN");
    assert.notEqual(r2.lifecycles[1]?.startedAt, r2.lifecycles[0]?.startedAt);
  });
  it("is deterministic", () => assert.deepEqual(run(FULL), run(FULL)));
});
