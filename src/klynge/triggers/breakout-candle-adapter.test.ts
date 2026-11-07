import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BreakoutCandleDecision } from "../price-action/breakout-candle.ts";
import { arbitrateStrategies } from "./strategy-arbitration.ts";
import { breakoutCandleToProposal } from "./breakout-candle-adapter.ts";

const t = Date.UTC(2026, 10, 6, 14, 45);
const candidate = (direction: "CALL" | "PUT"): BreakoutCandleDecision => ({
  direction, state: "CANDIDATE", reasons: ["structural candidate only"],
  entry: 105, stop: direction === "CALL" ? 99 : 111,
  target: direction === "CALL" ? 120 : 90, rewardRisk: 2.5
});
const proposal = (decision: BreakoutCandleDecision, dataQualityVerified = true) =>
  breakoutCandleToProposal({
    symbol: "TSLA", timeframe: "5m", evaluatedAt: t,
    standoutTimestamp: t - 900000, decision, dataQualityVerified
  });

describe("breakout candle arbitration adapter", () => {
  it("maps CALL candidate to breakout strategy but never certifies", () => {
    const p = proposal(candidate("CALL"));
    assert.equal(p.strategy, "K-BR-C");
    assert.equal(p.evidence, "CANDIDATE");
    assert.equal(p.certifiedDecision, undefined);
    assert.equal(arbitrateStrategies([p]).decision, "WAIT");
  });
  it("maps PUT candidate to bearish strategy but never certifies", () => {
    const p = proposal(candidate("PUT"));
    assert.equal(p.strategy, "K-BD-P");
    assert.equal(p.evidence, "CANDIDATE");
    assert.equal(arbitrateStrategies([p]).decision, "WAIT");
  });
  it("rejects candidates with missing upstream data quality", () => {
    const p = proposal(candidate("CALL"), false);
    assert.equal(p.evidence, "UNVERIFIED");
    assert.equal(arbitrateStrategies([p]).decision, "WAIT");
  });
  it("rejects blocked pattern evidence", () => {
    const p = proposal({ state: "BLOCKED", direction: "CALL", reasons: ["stale data"] });
    assert.equal(p.evidence, "UNVERIFIED");
  });
  it("rejects invalid or future standout timestamp", () => {
    const p = breakoutCandleToProposal({
      symbol: "TSLA", timeframe: "5m", evaluatedAt: t,
      standoutTimestamp: t - 1000, decision: candidate("CALL"),
      dataQualityVerified: true
    });
    assert.equal(p.evidence, "UNVERIFIED");
  });
  it("opposing candidate directions fail closed in arbitration", () => {
    const result = arbitrateStrategies([proposal(candidate("CALL")), proposal(candidate("PUT"))]);
    assert.equal(result.decision, "BLOCKED");
  });
  it("setup identity is stable across reevaluation", () => {
    const p1 = proposal(candidate("CALL"));
    const p2 = breakoutCandleToProposal({
      symbol: "TSLA", timeframe: "5m", evaluatedAt: t + 300000,
      standoutTimestamp: t - 900000, decision: candidate("CALL"),
      dataQualityVerified: true
    });
    assert.equal(p1.setupId, p2.setupId);
  });
});
