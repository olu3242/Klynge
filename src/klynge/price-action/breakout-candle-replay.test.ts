import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Candle } from "../domain/types.ts";
import { evaluateBreakoutCandle, type BreakoutCandleInput } from "./breakout-candle.ts";

const start = Date.UTC(2026, 10, 6, 14, 30);
const candle = (n: number, o: number, h: number, l: number, c: number, v = 1200): Candle => ({
  symbol: "NVDA", timeframe: "5m", timestamp: start + n * 300000,
  open: o, high: h, low: l, close: c, volume: v
});
const bars = [
  candle(0, 100, 104, 99, 103.5),
  candle(1, 103.7, 106, 103.6, 105, 1600),
  candle(2, 104.6, 106, 103.9, 105.2)
];
const base = (): BreakoutCandleInput => ({
  direction: "CALL", candles: bars, vwap: 103, ema9: 104, averageVolume: 1000,
  spx: "BULLISH", mnq: "BULLISH", spxEvaluatedAt: start + 900000,
  mnqEvaluatedAt: start + 900000, target: 120, targetKnownAt: start - 300000,
  evaluatedAt: start + 900000
});
describe("breakout-candle replay and structural invalidation", () => {
  it("blocks replay before all three five-minute closes", () => {
    for (const end of [start + 300000, start + 600000, start + 899999]) {
      assert.equal(evaluateBreakoutCandle({...base(), evaluatedAt: end}).state, "BLOCKED");
    }
  });
  it("does not look ahead to future completed bar", () => {
    const x = base();
    assert.equal(evaluateBreakoutCandle({...x, candles: x.candles.slice(0, 2)}).state, "BLOCKED");
  });
  it("blocks future-known targets even if the target would give >2R", () => {
    assert.equal(evaluateBreakoutCandle({...base(), targetKnownAt: start + 1}).state, "BLOCKED");
  });
  it("blocks stale market regime despite direction matching", () => {
    assert.equal(evaluateBreakoutCandle({...base(), spxEvaluatedAt: start + 300000}).state, "BLOCKED");
  });
  it("rejects breakout candle that breaches standout invalidation extreme", () => {
    const changed = [bars[0]!, candle(1, 103.7, 106, 98.8, 105, 1600), bars[2]!];
    assert.equal(evaluateBreakoutCandle({...base(), candles: changed}).state, "WAIT");
  });
  it("rejects retest candle that breaches standout invalidation extreme", () => {
    const changed = [bars[0]!, bars[1]!, candle(2, 104.6, 106, 98.8, 105.2)];
    assert.equal(evaluateBreakoutCandle({...base(), candles: changed}).state, "WAIT");
  });
  it("does not accept absent or future regime evidence", () => {
    const x = base();
    delete x.spxEvaluatedAt;
    assert.equal(evaluateBreakoutCandle(x).state, "BLOCKED");
    assert.equal(evaluateBreakoutCandle({...base(), mnqEvaluatedAt: start + 1200000}).state, "BLOCKED");
  });
  it("preserves candidate result on valid closed 5m historical evidence", () => {
    const result = evaluateBreakoutCandle(base());
    assert.equal(result.state, "CANDIDATE");
    assert.ok((result.rewardRisk ?? 0) >= 2);
    assert.equal("certifiedDecision" in result, false);
  });
});
