import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BULL_BARS } from "../setup-test-fixtures.ts";
import { evaluate, FAILED_RETEST } from "../triggers/trigger-test-helpers.ts";
import { evaluateOptions } from "./eligibility.ts";
import { DAY_MS } from "./metrics.ts";
import { callSetup, chain, contract, NOW, putSetup, UNDERLYING_PRICE } from "./options-test-fixtures.ts";
import { OPTIONS_RISK_NOTICE } from "./policy.ts";

const perfectCalls = [contract({ strike: 105 }), contract({ strike: 104, symbol: "TSLA-C-104" })];
const opts = (setup = callSetup(), contracts = perfectCalls, o = {}) => evaluateOptions({ setup, chain: chain(contracts, o), now: NOW, underlyingPrice: UNDERLYING_PRICE });

describe("options direction derives from the underlying", () => {
  it("CALL_SETUP + PUT contract => rejected", () => {
    const r = opts(callSetup(), [contract({ type: "PUT", delta: -0.5 })]);
    assert.equal(r.decision, "BLOCKED");
    assert.match(r.rejectedContracts[0]?.reasons[0] ?? "", /PUT contract does not match the CALL_SETUP/);
  });
  it("PUT_SETUP + CALL contract => rejected", () => {
    const r = opts(putSetup(), [contract({ type: "CALL" })]);
    assert.equal(r.eligibleContracts.length, 0);
    assert.ok(r.candidates[0]?.blockers.includes("WRONG_OPTION_DIRECTION"));
  });
  it("PUT_SETUP + good PUT contracts => ELIGIBLE PUTs only", () => {
    const r = opts(putSetup(), [contract({ type: "PUT", strike: 98, delta: -0.5 }), contract({ type: "CALL" })]);
    assert.equal(r.decision, "ELIGIBLE");
    assert.ok(r.eligibleContracts.every((c) => c.type === "PUT"));
  });
  it("mixed chain never decides direction (CALLs only for CALL_SETUP)", () => {
    const r = opts(callSetup(), [...perfectCalls, contract({ type: "PUT", delta: -0.5, symbol: "P" })]);
    assert.deepEqual(r.eligibleContracts.map((c) => c.type), ["CALL", "CALL"]);
  });
});

describe("no underlying setup = no options eligibility", () => {
  it("WAIT + perfect option chain => WAIT, nothing eligible", () => {
    const waitSetup = evaluate({ bars: BULL_BARS.slice(0, 26) });
    assert.equal(waitSetup.decision, "WAIT");
    const r = opts(waitSetup);
    assert.equal(r.decision, "WAIT");
    assert.deepEqual(r.eligibleContracts, []);
    assert.equal(r.candidates.length, 0);
    assert.ok(r.blockers.includes("NO_UNDERLYING_SETUP"));
    assert.equal(r.rejectedContracts.length, perfectCalls.length);
  });
  it("BLOCKED / INVALIDATED underlying => BLOCKED, nothing eligible", () => {
    const blocked = evaluate({ market: "mixed" });
    assert.equal(opts(blocked).decision, "BLOCKED");
    const invalidated = evaluate({ bars: FAILED_RETEST });
    assert.equal(invalidated.decision, "INVALIDATED");
    assert.equal(opts(invalidated).eligibleContracts.length, 0);
  });
  it("a forged CALL_SETUP is rejected", () => {
    const forged = { ...evaluate({ market: "mixed" }), decision: "CALL_SETUP" as const };
    const r = opts(forged);
    assert.equal(r.decision, "BLOCKED");
    assert.ok(r.blockers.includes("INVALID_UNDERLYING_DECISION"));
  });
});

describe("underlying / contract separation (mandatory)", () => {
  it("valid CALL_SETUP + no eligible call contracts: underlying stays CALL_SETUP, options BLOCKED", () => {
    const setup = callSetup();
    const before = JSON.stringify(setup);
    const r = opts(setup, [contract({ volume: 1 }), contract({ bid: 0, symbol: "Z" })]);
    assert.equal(setup.decision, "CALL_SETUP");
    assert.equal(JSON.stringify(setup), before);
    assert.equal(r.underlyingDecision, "CALL_SETUP");
    assert.equal(r.decision, "BLOCKED");
    assert.deepEqual(r.blockers, ["NO_ELIGIBLE_CONTRACTS"]);
    assert.match(r.reasons[0] ?? "", /underlying CALL_SETUP is unchanged/);
  });
  it("chain-level vetoes: mismatch, future snapshot, stale snapshot", () => {
    assert.ok(opts(callSetup(), perfectCalls, { underlying: "NVDA" }).blockers.includes("UNDERLYING_MISMATCH"));
    assert.ok(opts(callSetup(), perfectCalls, { timestamp: NOW + 1 }).blockers.includes("FUTURE_QUOTE"));
    assert.ok(opts(callSetup(), perfectCalls, { timestamp: NOW - 120_000 }).blockers.includes("STALE_CHAIN"));
  });
});

describe("eligibility output and ordering", () => {
  it("ELIGIBLE with explainability and the mandatory risk notice", () => {
    const r = opts();
    assert.equal(r.decision, "ELIGIBLE");
    assert.equal(r.riskNotice, OPTIONS_RISK_NOTICE);
    for (const c of r.candidates) {
      assert.ok(c.metrics);
      assert.equal(c.direction, "CALL");
      assert.ok(["GOOD", "MARGINAL", "POOR"].includes(c.liquidity));
    }
    assert.ok(!JSON.stringify(r).match(/best option|guaranteed|highest-profit/i));
  });
  it("documented deterministic ordering: liquidity, spread, DTE proximity, delta proximity, premium, symbol", () => {
    const a = contract({ symbol: "A", bid: 2, ask: 2.2 }); // 9.5% spread: MARGINAL (outside the GOOD band)
    const b = contract({ symbol: "B", bid: 2, ask: 2.1 });
    const c = contract({ symbol: "C", bid: 2, ask: 2.1, expiration: NOW + 26 * DAY_MS }); // DTE exactly at midpoint (26)
    const marginal = contract({ symbol: "D", bid: 2, ask: 2.05, volume: 150 }); // tighter spread but MARGINAL
    const r = opts(callSetup(), [a, b, c, marginal]);
    // GOOD first (C before B: DTE closer to the 26-day midpoint), then MARGINAL by spread (D 2.5% before A 9.5%).
    assert.deepEqual(r.eligibleContracts.map((x) => x.symbol), ["C", "B", "D", "A"]);
    assert.deepEqual(r.candidates.slice(0, 4).map((x) => x.riskState), ["ELIGIBLE", "ELIGIBLE", "CAUTION", "CAUTION"]);
  });
  it("is deterministic and frozen", () => {
    assert.equal(JSON.stringify(opts()), JSON.stringify(opts()));
    const r = opts();
    assert.throws(() => {
      (r as { decision: string }).decision = "ELIGIBLE";
      (r.eligibleContracts as unknown[]).push({});
    }, TypeError);
  });
});

