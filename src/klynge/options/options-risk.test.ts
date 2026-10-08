import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateContract } from "./contract-evaluation.ts";
import { contract, NOW, UNDERLYING_PRICE } from "./options-test-fixtures.ts";
import { DEFAULT_OPTIONS_POLICY } from "./policy.ts";
import type { OptionContract, OptionsPolicy } from "./types.ts";

const ev = (o: Partial<OptionContract>, policy: OptionsPolicy = DEFAULT_OPTIONS_POLICY, side: "CALL" | "PUT" = "CALL") =>
  evaluateContract(contract(o), { side, underlying: "TSLA", underlyingPrice: UNDERLYING_PRICE, now: NOW, policy });
const has = (o: Partial<OptionContract>, code: string, policy?: OptionsPolicy) => {
  const r = ev(o, policy);
  assert.equal(r.riskState, "BLOCKED", `${code}: ${r.blockers.join(",")}`);
  assert.ok(r.blockers.includes(code as never), `expected ${code} in ${r.blockers.join(",")}`);
};

describe("contract risk / data-quality vetoes", () => {
  it("baseline contract is ELIGIBLE with full explainability", () => {
    const r = ev({});
    assert.equal(r.riskState, "ELIGIBLE");
    assert.ok(r.eligibleReasons.some((x) => x.startsWith("DTE")));
    assert.ok(r.eligibleReasons.some((x) => x.includes("100% of premium paid")));
    assert.ok(r.eligibleReasons.some((x) => x.startsWith("Breakeven")));
  });
  it("wrong option direction", () => has({ type: "PUT", delta: -0.5 }, "WRONG_OPTION_DIRECTION"));
  it("zero bid", () => has({ bid: 0 }, "ZERO_BID"));
  it("zero ask is a malformed quote", () => has({ ask: 0, bid: 0 }, "INVALID_QUOTE"));
  it("NaN / Infinity / negative fields are malformed", () => {
    has({ bid: Number.NaN }, "INVALID_QUOTE");
    has({ ask: Number.POSITIVE_INFINITY }, "INVALID_QUOTE");
    has({ volume: -1 }, "INVALID_QUOTE");
    has({ strike: 0 }, "INVALID_QUOTE");
  });
  it("crossed market", () => has({ bid: 2.2, ask: 2.1 }, "CROSSED_MARKET"));
  it("stale quote (beyond max age) vs fresh at the boundary", () => {
    assert.ok(!ev({ timestamp: NOW - 60_000 }).blockers.includes("STALE_QUOTE"));
    has({ timestamp: NOW - 60_001 }, "STALE_QUOTE");
  });
  it("future quote is rejected (no lookahead)", () => has({ timestamp: NOW + 1 }, "FUTURE_QUOTE"));
  it("expired contract", () => has({ expiration: NOW }, "EXPIRED"));
  it("premium exceeds policy", () => {
    has({}, "PREMIUM_EXCEEDS_POLICY", { ...DEFAULT_OPTIONS_POLICY, maximumPremiumAtRisk: 209.99 });
    assert.equal(ev({}, { ...DEFAULT_OPTIONS_POLICY, maximumPremiumAtRisk: 210 }).riskState, "ELIGIBLE");
  });
  it("delta range: missing delta, outside range, inconsistent sign", () => {
    const { delta: _d, ...noDelta } = contract();
    void _d;
    const r = evaluateContract(noDelta, { side: "CALL", underlying: "TSLA", underlyingPrice: UNDERLYING_PRICE, now: NOW, policy: DEFAULT_OPTIONS_POLICY });
    assert.ok(r.blockers.includes("DELTA_UNAVAILABLE"));
    has({ delta: 0.29 }, "OUTSIDE_DELTA_RANGE");
    has({ delta: 0.71 }, "OUTSIDE_DELTA_RANGE");
    has({ delta: -0.5 }, "INVALID_QUOTE");
    assert.equal(ev({ delta: 0.3 }).riskState, "ELIGIBLE");
  });
  it("PUT deltas use absolute value", () => assert.equal(ev({ type: "PUT", delta: -0.45 }, DEFAULT_OPTIONS_POLICY, "PUT").riskState, "ELIGIBLE"));
  it("underlying mismatch", () => has({ underlying: "NVDA" }, "UNDERLYING_MISMATCH"));
});
