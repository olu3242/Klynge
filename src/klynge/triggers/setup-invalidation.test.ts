import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BULL_BARS, scenario } from "../setup-test-fixtures.ts";
import { evaluateSetup } from "./setup-engine.ts";
import { ACCEPTANCE_FAILURE, evaluate, FAILED_RETEST, INVALIDATION_BREACH, patch, RETEST_TOO_DEEP } from "./trigger-test-helpers.ts";

describe("structural invalidation", () => {
  it("failed bullish retest => INVALIDATED (not WAIT)", () => {
    const r = evaluate({ bars: FAILED_RETEST });
    assert.equal(r.decision, "INVALIDATED");
    assert.deepEqual(r.invalidationReasons, ["Failed retest: price closed materially back through the reclaimed level."]);
  });
  it("failed bearish retest => INVALIDATED", () => assert.equal(evaluate({ side: "BEARISH", bars: FAILED_RETEST }).decision, "INVALIDATED"));
  it("break followed by acceptance failure => INVALIDATED", () => assert.equal(evaluate({ bars: ACCEPTANCE_FAILURE }).decision, "INVALIDATED"));
  it("retest too deep => INVALIDATED", () => assert.equal(evaluate({ bars: RETEST_TOO_DEEP }).decision, "INVALIDATED"));
  it("invalidation price breached after confirmation => INVALIDATED", () => {
    const r = evaluate({ bars: INVALIDATION_BREACH });
    assert.equal(r.decision, "INVALIDATED");
    assert.equal(r.priceActionState, "INVALIDATED");
  });
  it("a fresh break after failure is a NEW lifecycle (WAIT), never a resumed setup", () => {
    const failed = evaluate({ bars: FAILED_RETEST });
    const r = evaluate({ bars: patch(26, [102.45, 102.5, 101.75, 101.8]) });
    assert.equal(r.decision, "WAIT");
    assert.equal(r.priceActionState, "BROKEN");
    assert.notEqual(r.setup?.setupId, failed.setup?.setupId);
  });
});

describe("market context changes during a setup", () => {
  const active = evaluate(); // CALL_SETUP
  const forming = evaluate({ bars: BULL_BARS.slice(0, 26) }); // WAIT, ACCEPTED lifecycle

  it("active CALL + regime -> MIXED => INVALIDATED (identity retained)", () => {
    const r = evaluate({ market: "mixed" }, { previous: active });
    assert.equal(r.decision, "INVALIDATED");
    assert.equal(r.setup?.setupId, active.setup?.setupId);
    assert.deepEqual(r.invalidationReasons, ["Market context changed against the active setup"]);
  });
  it("forming lifecycle + regime -> MIXED => INVALIDATED", () => {
    assert.equal(evaluate({ bars: BULL_BARS.slice(0, 26), market: "mixed" }, { previous: forming }).decision, "INVALIDATED");
  });
  it("no prior lifecycle + MIXED => BLOCKED", () => assert.equal(evaluate({ market: "mixed" }).decision, "BLOCKED"));
  it("previous WAIT without a lifecycle + MIXED => BLOCKED", () => {
    const pre = evaluate({ bars: BULL_BARS.slice(0, 22) });
    assert.equal(pre.setup, undefined);
    assert.equal(evaluate({ market: "mixed" }, { previous: pre }).decision, "BLOCKED");
  });
  it("RISK_ON -> UNKNOWN during an active setup => INVALIDATED", () => assert.equal(evaluate({ market: "stale" }, { previous: active }).decision, "INVALIDATED"));
  it("RISK_ON -> RISK_OFF during an active CALL => INVALIDATED", () => {
    const r = evaluate({ market: "opposite" }, { previous: active });
    assert.equal(r.decision, "INVALIDATED");
    assert.deepEqual(r.invalidationReasons, ["Market regime changed against the active setup"]);
  });
  it("PUT setup + RISK_OFF -> MIXED => INVALIDATED", () => {
    const put = evaluate({ side: "BEARISH" });
    assert.equal(put.decision, "PUT_SETUP");
    assert.equal(evaluate({ side: "BEARISH", market: "mixed" }, { previous: put }).decision, "INVALIDATED");
  });
});

describe("data quality changes during a setup", () => {
  const active = evaluate();
  it("bad target data halts an active CALL => INVALIDATED, never CALL", () => {
    const s = scenario();
    const bad = { ...s.target, candles: s.target.candles.map((c, i) => (i === 27 ? { ...c, volume: -1 } : c)) };
    const r = evaluateSetup({ marketTruth: s.marketTruth, target: bad, now: s.now, previous: active });
    assert.equal(r.decision, "INVALIDATED");
    assert.ok(r.blockers.includes("NEGATIVE_VOLUME"));
    assert.deepEqual(r.invalidationReasons, ["Data quality failure halted the active setup"]);
  });
  it("stale target data halts an active setup", () => {
    const s = scenario();
    const later = s.now + 30 * 60_000;
    const r = evaluateSetup({ marketTruth: { ...s.marketTruth, provenance: { ...s.marketTruth.provenance, evaluatedAt: later } }, target: s.target, now: later, previous: active });
    assert.notEqual(r.decision, "CALL_SETUP");
    assert.equal(r.decision, "INVALIDATED");
  });
  it("timestamp skew between target and market halts the setup", () => {
    const s = scenario();
    const short = { ...s.target, candles: s.target.candles.slice(0, -1) };
    const r = evaluateSetup({ marketTruth: s.marketTruth, target: short, now: s.now });
    assert.equal(r.decision, "BLOCKED");
    assert.ok(r.blockers.includes("TIMESTAMP_SKEW"));
  });
  it("an invalidated lifecycle is never resurrected, even when inputs recover", () => {
    const invalidated = evaluate({ market: "mixed" }, { previous: active });
    const r = evaluate({}, { previous: invalidated });
    assert.equal(r.decision, "INVALIDATED");
    assert.deepEqual(r.invalidationReasons, ["This lifecycle was already invalidated; a new lifecycle is required."]);
  });
  it("previous state for a different symbol has no effect", () => {
    const other = { ...evaluate({ market: "mixed" }, { previous: active }), symbol: "NVDA" };
    assert.equal(evaluate({}, { previous: other }).decision, "CALL_SETUP");
  });
  it("a forged previous state can never enable a setup", () => {
    const forged = { ...evaluate({ market: "mixed" }), decision: "CALL_SETUP" as const };
    assert.notEqual(evaluate({ market: "mixed" }, { previous: forged }).decision, "CALL_SETUP");
  });
});
