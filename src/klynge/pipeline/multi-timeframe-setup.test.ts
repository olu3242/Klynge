import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Direction } from "../domain/types.ts";
import { bullTargetFeed, END, trendFeed } from "../mtf-test-fixtures.ts";
import { scenario } from "../setup-test-fixtures.ts";
import type { HigherTimeframeBias } from "../timeframe/bias.ts";
import type { MultiTimeframeState } from "../timeframe/multi-timeframe.ts";
import { validateDecisionState } from "../triggers/invariants.ts";
import { evaluateSetup } from "../triggers/setup-engine.ts";
import { DEFAULT_SETUP_POLICY } from "../triggers/setup-policy.ts";
import type { KlyngeDecisionState } from "../triggers/types.ts";
import { evaluateMultiTimeframeSetup } from "./mtf-pipeline.ts";

const POLICY = { macro: "1d", structure: "1h", setup: "15m", execution: "5m" } as const;
const run = (side: "BULLISH" | "BEARISH" = "BULLISH") => {
  const d = side === "BULLISH" ? 0.05 : -0.05;
  return evaluateMultiTimeframeSetup({ target: bullTargetFeed("TSLA", side), spx: trendFeed("SPX", d, 5000), mnq: trendFeed("MNQ", d, 18000), now: END, timeframePolicy: POLICY });
};

/** MTF context stub for the single-session (5m) setup fixture. MTF can only gate/downgrade, so stubs cannot create setups. */
function stub(bias: HigherTimeframeBias, execution: Direction, now: number, o: Partial<MultiTimeframeState> = {}): MultiTimeframeState {
  const role = (r: "MACRO" | "STRUCTURE" | "SETUP" | "EXECUTION", direction: Direction) => ({ role: r, timeframe: "5m" as const, state: null, direction, lastClosedAt: now, fresh: true, reasons: [], blockers: [] });
  return {
    symbol: "TSLA",
    timestamp: now,
    macro: null,
    structure: null,
    setup: null,
    execution: null,
    roles: [role("MACRO", "NEUTRAL"), role("STRUCTURE", "NEUTRAL"), role("SETUP", "BULLISH"), role("EXECUTION", execution)],
    timeframes: { macro: "1d", structure: "1h", setup: "5m", execution: "1m" },
    bias,
    synchronized: true,
    reasons: [],
    blockers: [],
    ...o,
  };
}
const withMtf = (side: "BULLISH" | "BEARISH", mtf: (now: number) => MultiTimeframeState, previous?: KlyngeDecisionState, policy = DEFAULT_SETUP_POLICY) => {
  const s = scenario({ side });
  return evaluateSetup({ marketTruth: s.marketTruth, target: s.target, priorSession: s.priorSession!, now: s.now, multiTimeframe: mtf(s.now), policy, ...(previous ? { previous } : {}) });
};

describe("multi-timeframe pipeline (derived roles, end to end)", () => {
  it("RISK_ON + approved NEUTRAL bias + 15m sequence + 5m execution => CALL_SETUP", () => {
    const r = run();
    assert.equal(r.setup.decision, "CALL_SETUP");
    assert.equal(r.setup.timeframe, "15m");
    assert.deepEqual(r.setup.multiTimeframe, { bias: "NEUTRAL", synchronized: true, biasApproved: true, executionDirection: "BULLISH", executionConfirmed: true });
    assert.deepEqual(validateDecisionState(r.setup), []);
  });
  it("mirrored => PUT_SETUP", () => assert.equal(run("BEARISH").setup.decision, "PUT_SETUP"));
  it("multi-session warm-up: market truth + setup work on the setup timeframe with history", () => {
    const r = run();
    assert.equal(r.marketTruth.technical.spx?.timeframe, "15m");
    assert.equal(r.marketTruth.permission.permission, "ENABLED");
  });
  it("is deterministic", () => assert.equal(JSON.stringify(run()), JSON.stringify(run())));
});

describe("higher-timeframe gate", () => {
  it("baseline: aligned BULLISH bias + confirming execution => CALL_SETUP", () => assert.equal(withMtf("BULLISH", (n) => stub("BULLISH", "BULLISH", n)).decision, "CALL_SETUP"));
  it("CALL_SETUP + BEARISH higher-timeframe bias => BLOCKED", () => {
    const r = withMtf("BULLISH", (n) => stub("BEARISH", "BULLISH", n));
    assert.equal(r.decision, "BLOCKED");
    assert.ok(r.blockers.includes("HTF_CONFLICT"));
    assert.deepEqual(r.reasons, ["Higher-timeframe bias conflicts with the setup direction"]);
  });
  it("PUT_SETUP + BULLISH higher-timeframe bias => BLOCKED", () => {
    const r = withMtf("BEARISH", (n) => stub("BULLISH", "BEARISH", n));
    assert.equal(r.decision, "BLOCKED");
    assert.ok(r.blockers.includes("HTF_CONFLICT"));
  });
  it("CONFLICTED bias => BLOCKED (explicit conflict)", () => {
    const r = withMtf("BULLISH", (n) => stub("CONFLICTED", "BULLISH", n));
    assert.equal(r.decision, "BLOCKED");
    assert.deepEqual(r.reasons, ["Higher-timeframe context is conflicted"]);
  });
  it("NEUTRAL bias: approved by default, BLOCKED when policy disallows", () => {
    assert.equal(withMtf("BULLISH", (n) => stub("NEUTRAL", "BULLISH", n)).decision, "CALL_SETUP");
    const strict = { ...DEFAULT_SETUP_POLICY, multiTimeframe: { allowNeutralBias: false, requireExecutionConfirmation: true } };
    const r = withMtf("BULLISH", (n) => stub("NEUTRAL", "BULLISH", n), undefined, strict);
    assert.equal(r.decision, "BLOCKED");
    assert.ok(r.blockers.includes("HTF_NOT_APPROVED"));
  });
  it("unsynchronized context => BLOCKED", () => {
    const r = withMtf("BULLISH", (n) => stub("BULLISH", "BULLISH", n, { synchronized: false, blockers: ["STALE_DATA"] }));
    assert.equal(r.decision, "BLOCKED");
    assert.ok(r.blockers.includes("UNSYNCHRONIZED_TIMEFRAMES"));
  });
  it("context for another symbol, timeframe or clock => BLOCKED", () => {
    assert.equal(withMtf("BULLISH", (n) => stub("BULLISH", "BULLISH", n, { symbol: "NVDA" })).decision, "BLOCKED");
    assert.equal(withMtf("BULLISH", (n) => stub("BULLISH", "BULLISH", n, { timestamp: n - 1 })).decision, "BLOCKED");
    assert.equal(withMtf("BULLISH", (n) => stub("BULLISH", "BULLISH", n, { timeframes: { macro: "1d", structure: "1h", setup: "15m", execution: "5m" } })).decision, "BLOCKED");
  });
  it("active CALL + bias turns BEARISH => INVALIDATED (never silently reversed)", () => {
    const active = withMtf("BULLISH", (n) => stub("BULLISH", "BULLISH", n));
    const r = withMtf("BULLISH", (n) => stub("BEARISH", "BULLISH", n), active);
    assert.equal(r.decision, "INVALIDATED");
    assert.deepEqual(r.invalidationReasons, ["Higher-timeframe bias turned against the active setup"]);
  });
});

describe("execution context (downgrade only)", () => {
  it("execution NEUTRAL => WAIT (confirmation pending), with risk retained", () => {
    const r = withMtf("BULLISH", (n) => stub("BULLISH", "NEUTRAL", n));
    assert.equal(r.decision, "WAIT");
    assert.deepEqual(r.reasons, ["Execution timeframe confirmation pending."]);
    assert.ok(r.explanation.missing.includes("Execution timeframe confirmation"));
    assert.equal(r.risk?.allowed, true);
  });
  it("execution opposing => WAIT, never reversed into a PUT", () => {
    const r = withMtf("BULLISH", (n) => stub("BULLISH", "BEARISH", n));
    assert.equal(r.decision, "WAIT");
    assert.match(r.reasons[0] ?? "", /opposes/);
  });
  it("non-required confirmation: NEUTRAL execution allowed, opposing still WAIT", () => {
    const loose = { ...DEFAULT_SETUP_POLICY, multiTimeframe: { allowNeutralBias: true, requireExecutionConfirmation: false } };
    assert.equal(withMtf("BULLISH", (n) => stub("BULLISH", "NEUTRAL", n), undefined, loose).decision, "CALL_SETUP");
    assert.equal(withMtf("BULLISH", (n) => stub("BULLISH", "BEARISH", n), undefined, loose).decision, "WAIT");
  });
  it("execution can never upgrade a non-directional decision", () => {
    const s = scenario({ market: "mixed" });
    const r = evaluateSetup({ marketTruth: s.marketTruth, target: s.target, now: s.now, multiTimeframe: stub("BULLISH", "BULLISH", s.now) });
    assert.equal(r.decision, "BLOCKED");
  });
  it("PUT path mirrored: execution BULLISH against a PUT => WAIT", () => assert.equal(withMtf("BEARISH", (n) => stub("BEARISH", "BULLISH", n)).decision, "WAIT"));
  it("a forged directional state with an unconfirmed execution fails validation", () => {
    const r = withMtf("BULLISH", (n) => stub("BULLISH", "BULLISH", n));
    const forged = { ...r, multiTimeframe: { ...r.multiTimeframe!, executionConfirmed: false } };
    assert.ok(validateDecisionState(forged).length > 0);
  });
});
