import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contractMetrics, DAY_MS, dte } from "./metrics.ts";
import { contract, NOW } from "./options-test-fixtures.ts";
import { assertValidOptionsPolicy, DEFAULT_OPTIONS_POLICY, MAXIMUM_CAPITAL_AT_RISK_NOTICE, OPTIONS_RISK_NOTICE } from "./policy.ts";

describe("options domain metrics", () => {
  const m = contractMetrics(contract({ bid: 2, ask: 2.5 }), 100, NOW, 100);
  it("DTE in calendar days from the explicit clock", () => {
    assert.equal(dte(NOW + 7 * DAY_MS, NOW), 7);
    assert.equal(m.dte, 21);
  });
  it("mid, spread, spread %", () => {
    assert.equal(m.mid, 2.25);
    assert.equal(m.spread, 0.5);
    assert.equal(m.spreadPercent, (0.5 / 2.25) * 100);
  });
  it("moneyness: CALL (S−K)/S, PUT (K−S)/S", () => {
    assert.equal(m.moneynessPercent, -5);
    assert.equal(contractMetrics(contract({ type: "PUT", strike: 105 }), 100, NOW, 100).moneynessPercent, 5);
  });
  it("premium cost at the ask × multiplier; capital at risk = premium paid", () => {
    assert.equal(m.premiumCost, 250);
    assert.equal(m.capitalAtRisk, m.premiumCost);
  });
  it("breakeven: CALL strike + ask, PUT strike − ask", () => {
    assert.equal(m.breakeven, 107.5);
    assert.equal(contractMetrics(contract({ type: "PUT", strike: 100, ask: 3, bid: 2.9 }), 100, NOW, 100).breakeven, 97);
  });
  it("risk notices are explicit", () => {
    assert.equal(OPTIONS_RISK_NOTICE, "Klynge is not financial advice. Options involve substantial risk and may expire worthless. A long option position may lose 100% of the premium paid.");
    assert.equal(MAXIMUM_CAPITAL_AT_RISK_NOTICE, "Maximum capital at risk may equal 100% of premium paid.");
  });
  it("provisional defaults validate; invalid policies throw", () => {
    assert.doesNotThrow(() => assertValidOptionsPolicy(DEFAULT_OPTIONS_POLICY));
    assert.throws(() => assertValidOptionsPolicy({ ...DEFAULT_OPTIONS_POLICY, maximumDte: 1 }), RangeError);
    assert.throws(() => assertValidOptionsPolicy({ ...DEFAULT_OPTIONS_POLICY, minimumDelta: 0.8, maximumDelta: 0.2 }), RangeError);
    assert.throws(() => assertValidOptionsPolicy({ ...DEFAULT_OPTIONS_POLICY, minimumVolume: -1 }), RangeError);
  });
});
