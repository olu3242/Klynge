import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Candle } from "../domain/types.ts";
import { evaluateBreakoutCandle, type BreakoutCandleInput } from "./breakout-candle.ts";

const t = Date.UTC(2026, 10, 6, 14, 30);
const bar = (n: number, open: number, high: number, low: number, close: number, volume = 1200): Candle =>
  ({ symbol: "TSLA", timeframe: "5m", timestamp: t + n * 300000, open, high, low, close, volume });
const longBars = (): Candle[] => [
  bar(0, 100, 104, 99, 103.5),
  bar(1, 103.7, 106, 103.6, 105, 1600),
  bar(2, 104.6, 106, 103.9, 105.2)
];
const shortBars = (): Candle[] => [
  bar(0, 105, 106, 100, 101),
  bar(1, 101, 101.5, 98.5, 99, 1600),
  bar(2, 99.4, 100.2, 98.8, 99)
];
function input(direction: "CALL" | "PUT"): BreakoutCandleInput {
  return {
    candles: direction === "CALL" ? longBars() : shortBars(), direction,
    vwap: direction === "CALL" ? 103 : 101,
    ema9: direction === "CALL" ? 104 : 100.5,
    averageVolume: 1000, spx: direction === "CALL" ? "BULLISH" : "BEARISH",
    mnq: direction === "CALL" ? "BULLISH" : "BEARISH",
    spxEvaluatedAt: t + 900000, mnqEvaluatedAt: t + 900000,
    target: direction === "CALL" ? 120 : 80, targetKnownAt: t - 86400000,
    evaluatedAt: t + 900000
  };
}
describe("breakout candle candidate (never certification)", () => {
  it("returns bullish candidate only after closed breakout, retest, and >= 2R", () => {
    const result = evaluateBreakoutCandle(input("CALL"));
    assert.equal(result.state, "CANDIDATE");
    assert.ok((result.rewardRisk ?? 0) >= 2);
    assert.equal(result.stop, 99);
    assert.equal("certified" in result, false);
  });
  it("handles bearish symmetrical breakout and retest", () => {
    const result = evaluateBreakoutCandle(input("PUT"));
    assert.equal(result.state, "CANDIDATE");
    assert.equal(result.stop, 106);
    assert.ok((result.rewardRisk ?? 0) >= 2);
  });
  it("blocks unfinished 5m bar", () => {
    assert.equal(evaluateBreakoutCandle({...input("CALL"), evaluatedAt: t + 899999}).state, "BLOCKED");
  });
  it("blocks missing regime timestamps", () => {
    const x = input("CALL");
    delete x.mnqEvaluatedAt;
    assert.equal(evaluateBreakoutCandle(x).state, "BLOCKED");
  });
  it("blocks conflicting regime direction", () => {
    assert.equal(evaluateBreakoutCandle({...input("CALL"), mnq: "BEARISH"}).state, "BLOCKED");
  });
  it("blocks future-known target", () => {
    assert.equal(evaluateBreakoutCandle({...input("CALL"), targetKnownAt: t + 1}).state, "BLOCKED");
  });
  it("waits when 2R structural target is unavailable", () => {
    assert.equal(evaluateBreakoutCandle({...input("CALL"), target: 110}).state, "WAIT");
  });
  it("waits when breakout volume is insufficient", () => {
    assert.equal(evaluateBreakoutCandle({...input("CALL"), averageVolume: 2000}).state, "WAIT");
  });
  it("waits when breakout retest fails", () => {
    const x = input("CALL"); const candles = [...x.candles];
    candles[2] = bar(2, 105.5, 107, 105, 106);
    assert.equal(evaluateBreakoutCandle({...x, candles}).state, "WAIT");
  });
  it("blocks unknown target, missing VWAP and invalid parameters", () => {
    const missingTarget = input("PUT");
    delete missingTarget.target;
    assert.equal(evaluateBreakoutCandle(missingTarget).state, "BLOCKED");
    const missingVwap = input("CALL");
    delete missingVwap.vwap;
    assert.equal(evaluateBreakoutCandle(missingVwap).state, "BLOCKED");
    assert.equal(evaluateBreakoutCandle({...input("CALL"), minimumRewardRisk: 1}).state, "BLOCKED");
  });
  it("blocks malformed or non-consecutive bars", () => {
    const x = input("CALL");
    const candles = [...x.candles]; candles[2] = bar(4, 104.6, 106, 103.9, 105.2);
    assert.equal(evaluateBreakoutCandle({...x, candles}).state, "BLOCKED");
  });
});
