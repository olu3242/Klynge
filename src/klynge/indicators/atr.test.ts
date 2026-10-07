import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { atr, trueRange, trueRanges } from "./atr.ts";

describe("trueRange", () => {
  it("uses high-low when it dominates", () => assert.equal(trueRange({ high: 12, low: 8, close: 10 }, 10), 4));
  it("uses |high-prevClose| on gap up", () => assert.equal(trueRange({ high: 15, low: 13, close: 14 }, 10), 5));
  it("uses |low-prevClose| on gap down", () => assert.equal(trueRange({ high: 7, low: 5, close: 6 }, 10), 5));
});

describe("atr (canonical simple average)", () => {
  const bars = Array.from({ length: 20 }, (_, i) => ({ high: 10 + (i % 3), low: 9, close: 9.5 }));
  it("requires period + 1 bars", () => {
    assert.equal(atr(bars.slice(0, 14), 14), null);
    assert.notEqual(atr(bars.slice(0, 15), 14), null);
  });
  it("is the simple mean of the most recent 14 true ranges (not Wilder)", () => {
    const tr = trueRanges(bars);
    const expected = tr.slice(-14).reduce((a, b) => a + b, 0) / 14;
    assert.equal(atr(bars), expected);
    // Wilder smoothing over the same data would differ; guard against silent switching.
    let wilder = tr.slice(0, 14).reduce((a, b) => a + b, 0) / 14;
    for (const t of tr.slice(14)) wilder = (wilder * 13 + t) / 14;
    assert.notEqual(atr(bars), wilder);
  });
  it("is constant for constant ranges", () => {
    const flat = Array.from({ length: 15 }, () => ({ high: 11, low: 9, close: 10 }));
    assert.equal(atr(flat), 2);
  });
});
