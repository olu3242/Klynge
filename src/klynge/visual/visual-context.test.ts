import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_VISUAL_POLICY } from "./types.ts";
import { evaluateVisualContext, VISUAL_VERIFICATION_NOTICE } from "./visual-context.ts";
import { full, raw, session, T } from "./visual-test-fixtures.ts";

const LABELS = ["BULLISH CONTEXT", "BEARISH CONTEXT", "MIXED CONTEXT", "INSUFFICIENT CONTEXT"];

describe("visual context (deterministic, never a setup)", () => {
  it("target only: target context observed, overall INSUFFICIENT + WAIT, asks for SPX/MNQ", () => {
    const ctx = evaluateVisualContext(session([{ r: raw("TSLA", "BEARISH") }]), T);
    assert.equal(ctx.targetContext, "BEARISH CONTEXT");
    assert.equal(ctx.label, "INSUFFICIENT CONTEXT");
    assert.equal(ctx.permission, "WAIT");
    assert.deepEqual(ctx.reasons, ["Broad-market confirmation has not been provided"]);
    assert.deepEqual(ctx.nextSteps, ["+ Add SPX chart", "+ Add MNQ chart"]);
  });
  it("aligned bullish set => BULLISH CONTEXT + WAIT + verification notice", () => {
    const ctx = evaluateVisualContext(full("BULLISH", "BULLISH", "BULLISH"), T);
    assert.deepEqual([ctx.label, ctx.permission, ctx.regime], ["BULLISH CONTEXT", "WAIT", "RISK_ON"]);
    assert.equal(ctx.notice, VISUAL_VERIFICATION_NOTICE);
    assert.equal(ctx.evidenceMode, "VISUAL");
  });
  it("aligned bearish set => BEARISH CONTEXT + WAIT", () => assert.equal(evaluateVisualContext(full("BEARISH", "BEARISH", "BEARISH"), T).label, "BEARISH CONTEXT"));
  it("SPX/MNQ divergence => MIXED CONTEXT + BLOCKED (canonical regime table)", () => {
    const ctx = evaluateVisualContext(full("BULLISH", "BULLISH", "BEARISH"), T);
    assert.deepEqual([ctx.label, ctx.permission, ctx.regime], ["MIXED CONTEXT", "BLOCKED", "MIXED"]);
    assert.ok(ctx.blockers.includes("MIXED_REGIME"));
  });
  it("target conflicts with observed regime => BLOCKED", () => {
    const ctx = evaluateVisualContext(full("BEARISH", "BULLISH", "BULLISH"), T);
    assert.equal(ctx.permission, "BLOCKED");
    assert.ok(ctx.blockers.includes("TARGET_REGIME_CONFLICT"));
  });
  it("neutral target => MIXED CONTEXT + WAIT", () => assert.deepEqual([evaluateVisualContext(full("NEUTRAL", "BULLISH", "BULLISH"), T).label, evaluateVisualContext(full("NEUTRAL", "BULLISH", "BULLISH"), T).permission], ["MIXED CONTEXT", "WAIT"]));
  it("a labelled EMA on the wrong side keeps direction NEUTRAL", () => {
    const s = session([{ r: raw("TSLA", "BULLISH", { emaRelation: { value: { label: "EMA 9", relation: "BELOW" }, status: "OBSERVED", confidence: 0.9, evidence: "" } }) }, { r: raw("SPX") }, { r: raw("MNQ") }]);
    assert.equal(evaluateVisualContext(s, T).label, "MIXED CONTEXT");
  });
  describe("timing (mirrors TIMESTAMP_SKEW / staleness)", () => {
    const skew = DEFAULT_VISUAL_POLICY.maxChartSetSkewMs;
    const set = (spxAt: number) => session([{ r: raw("TSLA"), at: T }, { r: raw("SPX"), at: spxAt }, { r: raw("MNQ"), at: T }]);
    it("exactly at the skew window => allowed", () => assert.equal(evaluateVisualContext(set(T + skew), T + skew).permission, "WAIT"));
    it("beyond the skew window => BLOCKED, timing NOT_VERIFIED", () => {
      const ctx = evaluateVisualContext(set(T + skew + 1), T + skew + 1);
      assert.equal(ctx.permission, "BLOCKED");
      assert.ok(ctx.blockers.includes("TIMESTAMP_SKEW"));
      assert.ok(ctx.nextSteps.includes("Re-capture all charts together"));
    });
    it("stale chart set => BLOCKED", () => assert.ok(evaluateVisualContext(set(T), T + DEFAULT_VISUAL_POLICY.maxChartAgeMs + 1).blockers.includes("STALE_DATA")));
    it("capture time after evaluation => BLOCKED", () => assert.ok(evaluateVisualContext(set(T), T - 1).blockers.includes("FUTURE_CAPTURE")));
  });
  it("role violation => BLOCKED", () => {
    const s = session([{ r: raw("TSLA"), role: "SPX" }, { r: raw("MNQ") }]);
    assert.ok(evaluateVisualContext(s, T).blockers.includes("ROLE_VIOLATION"));
  });
  it("low-confidence required field => INSUFFICIENT CONTEXT, listed as missing", () => {
    const s = session([{ r: raw("TSLA", "BULLISH", { structure: { value: "HH_HL", status: "OBSERVED", confidence: 0.4, evidence: "" } }) }, { r: raw("SPX") }, { r: raw("MNQ") }]);
    const ctx = evaluateVisualContext(s, T);
    assert.equal(ctx.label, "INSUFFICIENT CONTEXT");
    assert.ok(ctx.missing.includes("TARGET.structure (NOT_VERIFIED)"));
  });
  it("always states what VISUAL mode cannot verify", () => {
    const ctx = evaluateVisualContext(full("BULLISH", "BULLISH", "BULLISH"), T);
    for (const x of ["ATR14", "Relative-volume baseline", "Reward-to-risk"]) assert.ok(ctx.notVerified.includes(x));
  });
  it("never yields CALL_SETUP / PUT_SETUP across the full direction matrix", () => {
    const dirs = ["BULLISH", "BEARISH", "NEUTRAL"] as const;
    for (const a of dirs) for (const b of dirs) for (const c of dirs) {
      const ctx = evaluateVisualContext(full(a, b, c), T);
      assert.ok(LABELS.includes(ctx.label));
      assert.ok(ctx.permission === "WAIT" || ctx.permission === "BLOCKED");
      assert.doesNotMatch(JSON.stringify(ctx), /CALL_SETUP|PUT_SETUP|ELIGIBLE/);
    }
  });
  it("is deterministic and frozen", () => {
    assert.deepEqual(evaluateVisualContext(full("BULLISH", "BULLISH", "BULLISH"), T), evaluateVisualContext(full("BULLISH", "BULLISH", "BULLISH"), T));
    assert.ok(Object.isFrozen(evaluateVisualContext(full("BULLISH", "BULLISH", "BULLISH"), T).blockers));
  });
});
