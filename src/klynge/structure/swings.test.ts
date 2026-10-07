import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findSwingPoints, swingsKnownAt } from "./swings.ts";

const bars = (highs: number[], lows?: number[]) => highs.map((h, i) => ({ timestamp: 1000 + i, high: h, low: lows ? (lows[i] as number) : h - 1 }));

describe("findSwingPoints", () => {
  it("detects a strict swing high with lookback 2", () => {
    const s = findSwingPoints(bars([1, 2, 5, 2, 1]));
    assert.deepEqual(s.filter((x) => x.type === "HIGH").map((x) => x.index), [2]);
  });
  it("detects a strict swing low", () => {
    const b = bars([9, 9, 9, 9, 9], [5, 4, 1, 4, 5]);
    assert.deepEqual(findSwingPoints(b).filter((x) => x.type === "LOW").map((x) => [x.index, x.price]), [[2, 1]]);
  });
  it("requires STRICT inequality (ties are not swings)", () => {
    assert.equal(findSwingPoints(bars([1, 5, 5, 2, 1])).filter((x) => x.type === "HIGH").length, 0);
    assert.equal(findSwingPoints(bars([1, 2, 5, 5, 1])).filter((x) => x.type === "HIGH").length, 0);
  });
  it("is not known until right-hand confirmation bars exist", () => {
    assert.equal(findSwingPoints(bars([1, 2, 5, 2])).length, 0);
    const s = findSwingPoints(bars([1, 2, 5, 2, 1]));
    const high = s.find((x) => x.type === "HIGH");
    assert.equal(high?.confirmedAtIndex, 4);
    assert.equal(high?.confirmedAtTimestamp, 1004);
  });
  it("no-lookahead filter", () => {
    const s = findSwingPoints(bars([1, 2, 5, 2, 1]));
    assert.equal(swingsKnownAt(s, 3).length, 0);
    assert.equal(swingsKnownAt(s, 4).length > 0, true);
  });
  it("respects custom lookback", () => {
    assert.equal(findSwingPoints(bars([1, 5, 2]), 1).filter((x) => x.type === "HIGH").length, 1);
    assert.equal(findSwingPoints(bars([1, 5, 2]), 2).length, 0);
    assert.throws(() => findSwingPoints(bars([1]), 0), RangeError);
  });
});
