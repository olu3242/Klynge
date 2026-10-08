import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyLiquidity, evaluateContract } from "./contract-evaluation.ts";
import { DAY_MS } from "./metrics.ts";
import { contract, NOW, UNDERLYING_PRICE } from "./options-test-fixtures.ts";
import { DEFAULT_OPTIONS_POLICY } from "./policy.ts";
import type { OptionContract } from "./types.ts";

// Delta range omitted so these tests isolate liquidity/DTE rules.
const { minimumDelta: _min, maximumDelta: _max, ...P } = DEFAULT_OPTIONS_POLICY;
void _min;
void _max;
const ev = (o: Partial<OptionContract>) => evaluateContract(contract(o), { side: "CALL", underlying: "TSLA", underlyingPrice: UNDERLYING_PRICE, now: NOW, policy: P });
// bid/ask chosen so spread% is exact: spread% = (ask−bid)/mid × 100
const withSpread = (pct: number) => {
  const mid = 2.5;
  const spread = (pct * mid) / 100;
  return { bid: mid - spread / 2, ask: mid + spread / 2 };
};

describe("liquidity thresholds (exact boundaries)", () => {
  it("spread exactly at max => allowed; just above => SPREAD_TOO_WIDE", () => {
    assert.ok(!ev(withSpread(10)).blockers.includes("SPREAD_TOO_WIDE"));
    assert.ok(ev(withSpread(10.01)).blockers.includes("SPREAD_TOO_WIDE"));
  });
  it("volume exactly at minimum => allowed; one below => INSUFFICIENT_VOLUME", () => {
    assert.ok(!ev({ volume: 100 }).blockers.includes("INSUFFICIENT_VOLUME"));
    assert.ok(ev({ volume: 99 }).blockers.includes("INSUFFICIENT_VOLUME"));
  });
  it("open interest exactly at minimum => allowed; one below => INSUFFICIENT_OPEN_INTEREST", () => {
    assert.ok(!ev({ openInterest: 500 }).blockers.includes("INSUFFICIENT_OPEN_INTEREST"));
    assert.ok(ev({ openInterest: 499 }).blockers.includes("INSUFFICIENT_OPEN_INTEREST"));
  });
  it("DTE exactly at min and max => allowed; outside => OUTSIDE_DTE_RANGE", () => {
    assert.ok(!ev({ expiration: NOW + 7 * DAY_MS }).blockers.includes("OUTSIDE_DTE_RANGE"));
    assert.ok(!ev({ expiration: NOW + 45 * DAY_MS }).blockers.includes("OUTSIDE_DTE_RANGE"));
    assert.ok(ev({ expiration: NOW + 7 * DAY_MS - 1 }).blockers.includes("OUTSIDE_DTE_RANGE"));
    assert.ok(ev({ expiration: NOW + 45 * DAY_MS + 1 }).blockers.includes("OUTSIDE_DTE_RANGE"));
  });
});

describe("liquidity states (transparent rule, no score)", () => {
  it("GOOD: spread <= max/2, volume >= 2×min, OI >= 2×min", () => assert.equal(classifyLiquidity(5, 200, 1000, P), "GOOD"));
  it("MARGINAL: meets minimums but not the GOOD band", () => {
    assert.equal(classifyLiquidity(5.01, 200, 1000, P), "MARGINAL");
    assert.equal(classifyLiquidity(5, 199, 1000, P), "MARGINAL");
    assert.equal(classifyLiquidity(5, 200, 999, P), "MARGINAL");
  });
  it("POOR: below any minimum", () => {
    assert.equal(classifyLiquidity(10.01, 200, 1000, P), "POOR");
    assert.equal(classifyLiquidity(1, 99, 1000, P), "POOR");
  });
  it("GOOD => ELIGIBLE, MARGINAL => CAUTION, POOR => BLOCKED", () => {
    assert.equal(ev({}).riskState, "ELIGIBLE");
    assert.equal(ev({ volume: 150 }).riskState, "CAUTION");
    assert.equal(ev({ volume: 50 }).riskState, "BLOCKED");
    assert.ok(ev({ volume: 50 }).blockers.includes("POOR_LIQUIDITY"));
  });
});
