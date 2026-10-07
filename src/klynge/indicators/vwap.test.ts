import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sessionVwap, typicalPrice, vwapSeries } from "./vwap.ts";

const bar = (h: number, l: number, c: number, v: number) => ({ high: h, low: l, close: c, volume: v });

describe("vwap", () => {
  it("typical price = (H+L+C)/3", () => assert.equal(typicalPrice(bar(12, 9, 9, 1)), 10));
  it("session VWAP = Σ(TP·V)/ΣV", () => {
    const candles = [bar(12, 9, 9, 100), bar(21, 18, 18, 300)] as never[];
    assert.equal(sessionVwap({ sessionId: "s", candles }), (10 * 100 + 19 * 300) / 400);
  });
  it("resets on session change", () => {
    const bars = [
      { ...bar(12, 9, 9, 100), s: "A" },
      { ...bar(21, 18, 18, 100), s: "A" },
      { ...bar(33, 30, 30, 100), s: "B" },
    ];
    const out = vwapSeries(bars, (b) => b.s);
    assert.deepEqual(out, [10, 14.5, 31]);
  });
  it("is null when cumulative volume is zero", () => {
    assert.deepEqual(vwapSeries([bar(1, 1, 1, 0)], () => "x"), [null]);
    assert.equal(sessionVwap({ sessionId: "s", candles: [] }), null);
  });
});
