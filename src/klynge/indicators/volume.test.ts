import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyVolume, relativeVolume } from "./volume.ts";

describe("relativeVolume", () => {
  it("excludes the current bar from its own baseline", () => {
    const bars = [...Array.from({ length: 20 }, () => ({ volume: 100 })), { volume: 300 }];
    const rv = relativeVolume(bars);
    assert.deepEqual(rv, { volume: 300, averageVolume: 100, ratio: 3 });
  });
  it("uses only the 20 bars immediately prior", () => {
    const bars = [{ volume: 1_000_000 }, ...Array.from({ length: 20 }, () => ({ volume: 50 })), { volume: 50 }];
    assert.equal(relativeVolume(bars)?.averageVolume, 50);
  });
  it("needs 21 bars", () => assert.equal(relativeVolume(Array.from({ length: 20 }, () => ({ volume: 1 }))), null));
  it("null on zero baseline", () => assert.equal(relativeVolume(Array.from({ length: 21 }, () => ({ volume: 0 }))), null));
});

describe("classifyVolume boundaries", () => {
  const cases: [number, string][] = [
    [1.5, "STRONG"],
    [1.49, "CONFIRMING"],
    [1.2, "CONFIRMING"],
    [1.19, "NORMAL"],
    [0.8, "NORMAL"],
    [0.79, "WEAK"],
    [3, "STRONG"],
    [0, "WEAK"],
    [NaN, "WEAK"],
  ];
  for (const [ratio, expected] of cases) it(`${ratio} => ${expected}`, () => assert.equal(classifyVolume(ratio), expected));
});
