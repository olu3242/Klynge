import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Candle } from "../domain/types.ts";
import { evaluateHistoricalReversal, type HistoricalReversalInput } from "./historical-reversal.ts";

const t = Date.UTC(2026, 9, 26, 14, 0);
const bar = (offset: number, open: number, high: number, low: number, close: number): Candle => ({
  symbol: "SPY", timeframe: "5m", timestamp: t + offset * 300000, open, high, low, close, volume: 1000
});
const base = (strategy: "K-HD-C" | "K-HR-P", candles: Candle[]): HistoricalReversalInput => ({
  strategy, candles, level: 100, levelKnownAt: t - 86400000, dailySma9: 100, dailySma50: 100,
  vwap: 100, ema9: 100, spx: strategy === "K-HD-C" ? "BULLISH" : "BEARISH",
  mnq: strategy === "K-HD-C" ? "BULLISH" : "BEARISH", evaluatedAt: t + 600000
});
describe("historical reversal candidate gate", () => {
  it("observes bullish support sweep and continuation, never certifies a trade", () => {
    const result = evaluateHistoricalReversal(base("K-HD-C", [bar(0,100,101,99,100.5),bar(1,100.5,102,100.2,101.5)]));
    assert.equal(result.state, "CANDIDATE");
    assert.equal(result.direction, "BULLISH");
  });
  it("observes bearish resistance sweep and continuation", () => {
    const result = evaluateHistoricalReversal(base("K-HR-P", [bar(0,100,101,99,99.5),bar(1,99.5,99.8,98,98.5)]));
    assert.equal(result.state, "CANDIDATE");
    assert.equal(result.direction, "BEARISH");
  });
  it("blocks unfinished five-minute bars", () => {
    const input = base("K-HD-C", [bar(0,100,101,99,100.5),bar(1,100.5,102,100,101.5)]);
    assert.equal(evaluateHistoricalReversal({...input, evaluatedAt:t+300001}).state,"BLOCKED");
  });
  it("blocks future-known levels", () => {
    const input = base("K-HD-C", [bar(0,100,101,99,100.5),bar(1,100.5,102,100,101.5)]);
    assert.equal(evaluateHistoricalReversal({...input, levelKnownAt:t+1}).state,"BLOCKED");
  });
  it("blocks missing market alignment", () => {
    const input = base("K-HD-C", [bar(0,100,101,99,100.5),bar(1,100.5,102,100,101.5)]);
    assert.equal(evaluateHistoricalReversal({...input, mnq:"BEARISH"}).state,"BLOCKED");
  });
  it("waits when a sweep is absent", () => {
    const result = evaluateHistoricalReversal(base("K-HD-C", [bar(0,101,102,100.1,101.5),bar(1,101.5,103,101,102)]));
    assert.equal(result.state,"WAIT");
  });
  it("blocks missing daily SMA inputs", () => {
    const input = base("K-HR-P", [bar(0,100,101,99,99.5),bar(1,99.5,99.8,98,98.5)]);
    assert.equal(evaluateHistoricalReversal({...input, dailySma9:undefined}).state,"BLOCKED");
  });
});
