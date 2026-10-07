import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ema, emaSlope, sma } from "./ema.ts";

describe("ema", () => {
  it("seeds with the SMA of the first period", () => {
    assert.deepEqual(ema([1, 2, 3], 3), [2]);
  });
  it("applies multiplier 2/(period+1)", () => {
    const out = ema([1, 2, 3, 4, 5], 3); // k = 0.5
    assert.deepEqual(out, [2, 3, 4]);
  });
  it("EMA9 on a known series", () => {
    const values = Array.from({ length: 12 }, (_, i) => i + 1);
    const out = ema(values, 9);
    const k = 0.2;
    let e = 5; // SMA(1..9)
    const expected = [e];
    for (const v of [10, 11, 12]) {
      e = v * k + e * (1 - k);
      expected.push(e);
    }
    assert.equal(out.length, 4);
    out.forEach((v, i) => assert.ok(Math.abs(v - (expected[i] as number)) < 1e-12));
  });
  it("returns [] when fewer values than period", () => assert.deepEqual(ema([1, 2], 9), []));
  it("rejects invalid period and non-finite input", () => {
    assert.throws(() => ema([1, 2, 3], 0), RangeError);
    assert.throws(() => ema([1, 2, 3], 1.5), RangeError);
    assert.throws(() => ema([1, NaN, 3], 2), RangeError);
  });
  it("sma rejects empty input", () => assert.throws(() => sma([]), RangeError));
});

describe("emaSlope", () => {
  it("is last minus previous", () => assert.equal(emaSlope([1, 2, 3.5]), 1.5));
  it("is negative when falling", () => assert.equal(emaSlope([5, 4]), -1));
  it("is 0 with fewer than 2 values", () => {
    assert.equal(emaSlope([]), 0);
    assert.equal(emaSlope([42]), 0);
  });
});
