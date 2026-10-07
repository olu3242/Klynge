import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SwingPoint } from "../domain/types.ts";
import { makeCandles } from "../test-fixtures.ts";
import { classifyStructure, confirmedStructure } from "./structure.ts";

let idx = 0;
const H = (price: number): SwingPoint => ({ index: idx++, timestamp: idx, price, type: "HIGH", confirmedAtIndex: idx + 2, confirmedAtTimestamp: idx + 2 });
const L = (price: number): SwingPoint => ({ index: idx++, timestamp: idx, price, type: "LOW", confirmedAtIndex: idx + 2, confirmedAtTimestamp: idx + 2 });

describe("classifyStructure", () => {
  it("HH + HL => HH_HL", () => assert.equal(classifyStructure([L(1), H(5), L(2), H(6)]), "HH_HL"));
  it("LH + LL => LH_LL", () => assert.equal(classifyStructure([H(6), L(2), H(5), L(1)]), "LH_LL"));
  it("HH + LL => MIXED", () => assert.equal(classifyStructure([H(5), L(2), H(6), L(1)]), "MIXED"));
  it("LH + HL => MIXED", () => assert.equal(classifyStructure([H(6), L(1), H(5), L(2)]), "MIXED"));
  it("equal highs => MIXED", () => assert.equal(classifyStructure([H(5), L(1), H(5), L(2)]), "MIXED"));
  it("insufficient swings => MIXED", () => {
    assert.equal(classifyStructure([]), "MIXED");
    assert.equal(classifyStructure([H(5), H(6), L(1)]), "MIXED");
  });
  it("uses only the most recent two of each", () => assert.equal(classifyStructure([H(9), L(0), H(5), L(1), H(6), L(2)]), "HH_HL"));
});

describe("confirmedStructure on fixtures", () => {
  it("uptrend => HH_HL", () => assert.equal(confirmedStructure(makeCandles({ trend: "up" })), "HH_HL"));
  it("downtrend => LH_LL", () => assert.equal(confirmedStructure(makeCandles({ trend: "down" })), "LH_LL"));
  it("flat => MIXED", () => assert.equal(confirmedStructure(makeCandles({ trend: "flat" })), "MIXED"));
});
