import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isDirectionallyEligible } from "../policies/invariants.ts";
import { FIVE_MIN, makeSession, nowAfter, T0, withCandle } from "../test-fixtures.ts";
import { evaluateMarketTruth } from "./market-truth.ts";
import { KLYNGE_ENGINE_VERSION, KLYNGE_RULE_HISTORY, KLYNGE_RULE_VERSION } from "./version.ts";

const up = (symbol: string) => makeSession({ symbol, trend: "up" });
const down = (symbol: string) => makeSession({ symbol, trend: "down" });
const now = nowAfter(up("SPX"));

describe("evaluateMarketTruth (end-to-end)", () => {
  it("aligned bullish => RISK_ON => ENABLED", () => {
    const s = evaluateMarketTruth({ spx: up("SPX"), mnq: up("MNQ"), now });
    assert.equal(s.regime.regime, "RISK_ON");
    assert.equal(s.permission.permission, "ENABLED");
    assert.ok(isDirectionallyEligible(s.permission));
  });
  it("aligned bearish => RISK_OFF => ENABLED", () => {
    const s = evaluateMarketTruth({ spx: down("SPX"), mnq: down("MNQ"), now });
    assert.equal(s.regime.regime, "RISK_OFF");
    assert.equal(s.permission.permission, "ENABLED");
  });
  it("divergence => MIXED => BLOCKED", () => {
    const s = evaluateMarketTruth({ spx: up("SPX"), mnq: down("MNQ"), now });
    assert.equal(s.regime.regime, "MIXED");
    assert.equal(s.permission.permission, "BLOCKED");
  });
  it("bad data on one leg => UNKNOWN => BLOCKED, no technical state", () => {
    const s = evaluateMarketTruth({ spx: up("SPX"), mnq: withCandle(up("MNQ"), 5, { volume: -1 }), now });
    assert.equal(s.technical.mnq, null);
    assert.equal(s.regime.regime, "UNKNOWN");
    assert.equal(s.permission.permission, "BLOCKED");
    assert.ok(s.permission.blockers.includes("NEGATIVE_VOLUME"));
  });
  it("stale data => BLOCKED", () => {
    const s = evaluateMarketTruth({ spx: up("SPX"), mnq: up("MNQ"), now: now + 30 * 60_000 });
    assert.equal(s.permission.permission, "BLOCKED");
    assert.ok(s.permission.blockers.includes("STALE_DATA"));
  });
  it("insufficient history => BLOCKED", () => {
    const short = (sym: string) => makeSession({ symbol: sym, trend: "up", n: 18 });
    const s = evaluateMarketTruth({ spx: short("SPX"), mnq: short("MNQ"), now: T0 + 18 * FIVE_MIN });
    assert.equal(s.permission.permission, "BLOCKED");
    assert.ok(s.permission.blockers.includes("INSUFFICIENT_HISTORY"));
  });
  it("snapshot skew => UNKNOWN => BLOCKED", () => {
    // MNQ ends one bar earlier than SPX (5m skew > 60s policy).
    const mnq = up("MNQ");
    const truncated = { ...mnq, candles: mnq.candles.slice(0, -1) };
    const s = evaluateMarketTruth({ spx: up("SPX"), mnq: truncated, now });
    assert.equal(s.regime.regime, "UNKNOWN");
    assert.equal(s.dataQuality.timestampSkew, true);
    assert.equal(s.permission.permission, "BLOCKED");
    assert.ok(s.permission.blockers.includes("TIMESTAMP_SKEW"));
  });
  it("missing data => BLOCKED", () => {
    const empty = { ...up("MNQ"), candles: [] };
    const s = evaluateMarketTruth({ spx: up("SPX"), mnq: empty, now });
    assert.ok(s.permission.blockers.includes("NO_DATA"));
  });
  it("carries provenance from the explicit clock", () => {
    const s = evaluateMarketTruth({ spx: up("SPX"), mnq: up("MNQ"), now });
    assert.deepEqual(s.provenance, { engineVersion: KLYNGE_ENGINE_VERSION, ruleVersion: KLYNGE_RULE_VERSION, evaluatedAt: now });
    assert.equal(KLYNGE_ENGINE_VERSION, "0.6.0");
    assert.equal(KLYNGE_RULE_VERSION, "production-calibration-v1");
    // Historical provenance is preserved, never rewritten.
    assert.deepEqual(KLYNGE_RULE_HISTORY.map((h) => h.ruleVersion), ["market-truth-v1", "setup-engine-v1", "mtf-options-v1", "visual-intake-v1", "auth-live-data-v1", "production-calibration-v1"]);
  });
});

describe("determinism", () => {
  it("identical input => identical output (100 runs)", () => {
    const input = { spx: up("SPX"), mnq: down("MNQ"), now };
    const first = JSON.stringify(evaluateMarketTruth(input));
    for (let i = 0; i < 100; i++) assert.equal(JSON.stringify(evaluateMarketTruth(structuredClone(input))), first);
  });
  it("contains no wall-clock time, randomness or generated ids", () => {
    const s = evaluateMarketTruth({ spx: up("SPX"), mnq: up("MNQ"), now: 123_456 });
    assert.equal(s.provenance.evaluatedAt, 123_456);
    const text = JSON.stringify(s);
    assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}-/.test(text), false);
  });
});
