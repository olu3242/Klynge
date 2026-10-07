import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { atr, atrSeries } from "./atr.ts";

describe("atrSeries (no lookahead)", () => {
  const bars = Array.from({ length: 30 }, (_, i) => ({ high: 10 + (i % 4), low: 9 - (i % 3) * 0.5, close: 9.5 + (i % 2) }));
  it("null until 15 bars, then equals atr() on the prefix", () => {
    const s = atrSeries(bars);
    assert.ok(s.slice(0, 14).every((v) => v === null));
    for (let i = 14; i < bars.length; i++) assert.equal(s[i], atr(bars.slice(0, i + 1)));
  });
  it("future bars never change past values", () => {
    const a = atrSeries(bars.slice(0, 20));
    const b = atrSeries(bars);
    assert.deepEqual(b.slice(0, 20), a);
  });
});
