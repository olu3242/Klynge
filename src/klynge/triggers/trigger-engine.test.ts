import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BULL_BARS, scenario } from "../setup-test-fixtures.ts";
import { makeSession } from "../test-fixtures.ts";
import { isDirectionalDecision, validateDecisionState } from "./invariants.ts";
import { evaluateSetup } from "./setup-engine.ts";
import { DEFAULT_SETUP_POLICY } from "./setup-policy.ts";
import { evaluate, NEUTRAL_TARGET, NO_ACCEPTANCE, NO_CONTINUATION, NO_LEVEL, NO_RETEST, riskPolicy } from "./trigger-test-helpers.ts";

describe("trigger engine — directional setups", () => {
  it("RISK_ON + BULLISH target + complete bullish sequence + valid risk => CALL_SETUP", () => {
    const r = evaluate();
    assert.equal(r.decision, "CALL_SETUP");
    assert.equal(r.regime, "RISK_ON");
    assert.equal(r.targetDirection, "BULLISH");
    assert.equal(r.priceActionState, "CONFIRMED");
    assert.equal(r.confirmationState, "CONFIRMED");
    assert.equal(r.risk?.allowed, true);
    assert.ok((r.risk?.rewardRiskRatio ?? 0) >= 2);
    assert.ok(r.risk?.invalidation !== undefined && r.risk.target !== undefined);
    assert.equal(r.setup?.direction, "CALL");
    assert.deepEqual(validateDecisionState(r), []);
  });
  it("RISK_OFF + BEARISH target + complete bearish sequence + valid risk => PUT_SETUP", () => {
    const r = evaluate({ side: "BEARISH" });
    assert.equal(r.decision, "PUT_SETUP");
    assert.equal(r.regime, "RISK_OFF");
    assert.equal(r.targetDirection, "BEARISH");
    assert.equal(r.setup?.direction, "PUT");
    assert.ok((r.risk?.invalidation ?? 0) > (r.risk?.entryZone?.max ?? Infinity));
    assert.deepEqual(validateDecisionState(r), []);
  });
  it("regime alone is never a setup (RISK_ON before any break => WAIT)", () => {
    const r = evaluate({ bars: BULL_BARS.slice(0, 23) });
    assert.equal(r.regime, "RISK_ON");
    assert.equal(r.decision, "WAIT");
  });
});

describe("trigger engine — each mandatory condition removed independently", () => {
  const cases: [string, () => ReturnType<typeof evaluate>, string][] = [
    ["market permission (stale data)", () => evaluate({ market: "stale" }), "BLOCKED"],
    ["regime RISK_ON (MIXED instead)", () => evaluate({ market: "mixed" }), "BLOCKED"],
    ["target BULLISH (NEUTRAL instead)", () => evaluate({ bars: NEUTRAL_TARGET }), "WAIT"],
    ["valid level", () => evaluate({ bars: NO_LEVEL }), "WAIT"],
    ["bullish break", () => evaluate({ bars: BULL_BARS.slice(0, 23) }), "WAIT"],
    ["acceptance", () => evaluate({ bars: NO_ACCEPTANCE }), "WAIT"],
    ["retest", () => evaluate({ bars: NO_RETEST }), "WAIT"],
    ["confirmation (no continuation)", () => evaluate({ bars: NO_CONTINUATION }), "WAIT"],
    ["valid target", () => evaluate({ withPrior: false }), "BLOCKED"],
    ["minimum R:R", () => evaluate({}, { policy: riskPolicy({ minimumRewardRiskRatio: 10 }) }), "BLOCKED"],
    ["stop within ATR limit", () => evaluate({}, { policy: riskPolicy({ maximumStopAtr: 0.3 }) }), "BLOCKED"],
    ["price within entry zone", () => evaluate({}, { policy: riskPolicy({ maximumExtensionAtr: 0.1 }) }), "BLOCKED"],
  ];
  for (const [name, make, expected] of cases) {
    it(`without ${name} => ${expected}, never CALL_SETUP`, () => {
      const r = make();
      assert.equal(r.decision, expected);
      assert.equal(isDirectionalDecision(r), false);
    });
  }
  it("no valid target => NO_TARGET blocker", () => assert.ok(evaluate({ withPrior: false }).blockers.includes("NO_TARGET")));
  it("R:R too low => explicit reason", () => {
    const r = evaluate({}, { policy: riskPolicy({ minimumRewardRiskRatio: 10 }) });
    assert.ok(r.blockers.includes("INSUFFICIENT_REWARD_RISK"));
    assert.ok(r.explanation.riskBlockers.includes("Insufficient reward relative to structural risk"));
  });
  it("stop too wide => STOP_TOO_WIDE", () => assert.ok(evaluate({}, { policy: riskPolicy({ maximumStopAtr: 0.3 }) }).blockers.includes("STOP_TOO_WIDE")));
  it("bearish removals mirror (no continuation => WAIT, no target => BLOCKED)", () => {
    assert.equal(evaluate({ side: "BEARISH", bars: NO_CONTINUATION }).decision, "WAIT");
    assert.equal(evaluate({ side: "BEARISH", withPrior: false }).decision, "BLOCKED");
  });
});

describe("trigger engine — conflicts", () => {
  it("RISK_ON + BEARISH target => BLOCKED (conflict)", () => {
    const r = evaluate({ side: "BEARISH", market: "opposite" });
    assert.equal(r.regime, "RISK_ON");
    assert.equal(r.decision, "BLOCKED");
    assert.deepEqual(r.reasons, ["Target direction conflicts with market regime"]);
  });
  it("RISK_OFF + BULLISH target => BLOCKED (conflict)", () => {
    const r = evaluate({ market: "opposite" });
    assert.equal(r.regime, "RISK_OFF");
    assert.equal(r.decision, "BLOCKED");
    assert.ok(r.blockers.includes("TARGET_REGIME_CONFLICT"));
  });
  it("MIXED + perfect target setup => BLOCKED", () => {
    const r = evaluate({ market: "mixed" });
    assert.equal(r.regime, "MIXED");
    assert.equal(r.decision, "BLOCKED");
    assert.ok(r.blockers.includes("MIXED_REGIME"));
  });
  it("UNKNOWN + perfect target setup => BLOCKED", () => {
    const r = evaluate({ market: "stale" });
    assert.equal(r.regime, "UNKNOWN");
    assert.equal(r.decision, "BLOCKED");
  });
  it("forged market permission (ENABLED over MIXED) is re-checked => BLOCKED", () => {
    const s = scenario({ market: "mixed" });
    const forged = { ...s.marketTruth, permission: { permission: "ENABLED" as const, reasons: [], blockers: [] } };
    assert.equal(evaluateSetup({ marketTruth: forged, target: s.target, now: s.now }).decision, "BLOCKED");
  });
  it("market-truth snapshot from a different clock => BLOCKED", () => {
    const s = scenario();
    const r = evaluateSetup({ marketTruth: s.marketTruth, target: s.target, now: s.now + 1 });
    assert.equal(r.decision, "BLOCKED");
    assert.ok(r.blockers.includes("INCONSISTENT_STATE"));
  });
  it("bad target data => BLOCKED", () => {
    const s = scenario();
    const bad = { ...s.target, candles: s.target.candles.map((c, i) => (i === 5 ? { ...c, close: c.high + 5 } : c)) };
    const r = evaluateSetup({ marketTruth: s.marketTruth, target: bad, now: s.now });
    assert.equal(r.decision, "BLOCKED");
    assert.ok(r.blockers.includes("MALFORMED_OHLC"));
  });
  it("invalid prior session => BLOCKED", () => {
    const s = scenario();
    const r = evaluateSetup({ marketTruth: s.marketTruth, target: s.target, now: s.now, priorSession: { ...(s.priorSession as NonNullable<typeof s.priorSession>), symbol: "NVDA" } });
    assert.equal(r.decision, "BLOCKED");
  });
  it("target timeframe must match market context (multi-timeframe not yet supported)", () => {
    const s = scenario();
    const tf = makeSession({ symbol: "TSLA", timeframe: "1m", n: 28, open: s.now - 28 * 60_000 });
    const r = evaluateSetup({ marketTruth: s.marketTruth, target: tf, now: s.now });
    assert.equal(r.decision, "BLOCKED");
    assert.ok(r.blockers.includes("MULTI_TIMEFRAME_UNSUPPORTED"));
  });
});

describe("trigger engine — determinism & integrity", () => {
  it("identical input => identical levels, transitions, confirmation, risk and decision", () => {
    const s = scenario();
    const input = { marketTruth: s.marketTruth, target: s.target, now: s.now, ...(s.priorSession ? { priorSession: s.priorSession } : {}) };
    const first = JSON.stringify(evaluateSetup(input));
    for (let i = 0; i < 20; i++) assert.equal(JSON.stringify(evaluateSetup(structuredClone(input))), first);
  });
  it("deterministic setup identity (no random ids)", () => {
    const r = evaluate();
    assert.equal(r.setup?.setupId, `TSLA:5m:CALL:${r.level?.id}:${r.setup?.startedAt}`);
    assert.equal(r.transitions.find((t) => t.to === "BROKEN")?.timestamp, r.setup?.startedAt);
  });
  it("output is deep-frozen", () => {
    const r = evaluate();
    assert.throws(() => {
      (r as { decision: string }).decision = "WAIT";
    }, TypeError);
    assert.ok(Object.isFrozen(r.risk));
  });
  it("carries setup-engine provenance", () => {
    const r = evaluate();
    assert.equal(r.provenance.ruleVersion, "setup-engine-v1");
    assert.equal(r.provenance.engineVersion, "0.2.0");
  });
  it("does not mutate inputs", () => {
    const s = scenario();
    const copy = structuredClone(s);
    evaluateSetup({ marketTruth: s.marketTruth, target: s.target, now: s.now });
    assert.deepEqual(s.target, copy.target);
  });
  it("rejects invalid setup policy", () => {
    assert.throws(() => evaluate({}, { policy: { ...DEFAULT_SETUP_POLICY, acceptance: { requiredCloses: 0, maximumFailureDistanceAtr: 0.25 } } }), RangeError);
  });
  it("quality: confirming continuation volume => HIGH, otherwise STANDARD", () => {
    assert.equal(evaluate({ volumes: BULL_BARS.map((_, i) => (i === 27 ? 1200 : 1000)) }).confirmationQuality, "HIGH");
    assert.equal(evaluate({ volumes: BULL_BARS.map((_, i) => (i === 27 ? 1190 : 1000)) }).confirmationQuality, "STANDARD");
    assert.equal(evaluate({ volumes: BULL_BARS.map((_, i) => (i === 27 ? 300 : 1000)) }).decision, "CALL_SETUP"); // low volume does not invalidate
  });
});
