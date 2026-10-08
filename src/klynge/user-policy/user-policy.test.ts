import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BULL_BARS } from "../setup-test-fixtures.ts";
import { evaluate } from "../triggers/trigger-test-helpers.ts";
import { applyUserPolicy, DEFAULT_USER_RISK_POLICY, validateUserRiskPolicy } from "./user-policy.ts";
import type { UserRiskPolicy } from "./user-policy.ts";

const call = evaluate();
const wait = evaluate({ bars: BULL_BARS.slice(0, 26) });
const blocked = evaluate({ market: "mixed" });
const permissive: UserRiskPolicy = { ...DEFAULT_USER_RISK_POLICY, optionsRiskAcknowledged: true };

describe("user risk policies restrict, never override", () => {
  it("engine WAIT / BLOCKED stay exactly as decided under the most permissive policy", () => {
    for (const d of [wait, blocked]) {
      const v = applyUserPolicy({ decision: d, policy: permissive, regularSession: true });
      assert.equal(v.engineDecision, d.decision);
      assert.equal(v.withinUserPolicy, false);
      assert.deepEqual(v.vetoes, []);
    }
  });
  it("CALL_SETUP + restrictive policy => vetoes recorded separately; the engine decision object is untouched", () => {
    const before = JSON.stringify(call);
    const v = applyUserPolicy({ decision: call, policy: { ...permissive, allowedInstruments: ["NVDA"], sessionPreference: "REGULAR_HOURS_ONLY", maxLossPerTrade: 0.01 }, regularSession: false });
    assert.equal(v.engineDecision, "CALL_SETUP");
    assert.equal(v.withinUserPolicy, false);
    assert.deepEqual(v.vetoes.map((x) => x.code).sort(), ["INSTRUMENT_NOT_ALLOWED", "LOSS_TOLERANCE_EXCEEDED", "SESSION_NOT_ALLOWED"]);
    assert.equal(JSON.stringify(call), before);
    assert.ok(Object.isFrozen(v));
  });
  it("within limits => eligible for the user, with an informational hypothetical size", () => {
    const v = applyUserPolicy({ decision: call, policy: { ...permissive, maxLossPerTrade: 100, maxCapitalExposure: 10_000 }, regularSession: true });
    assert.equal(v.withinUserPolicy, true);
    const entry = (call.risk!.entryZone!.min + call.risk!.entryZone!.max) / 2;
    assert.equal(v.hypotheticalMaxShares, Math.min(Math.floor(100 / (entry - call.risk!.invalidation!)), Math.floor(10_000 / entry)));
  });
  it("options eligibility needs explicit options-risk acknowledgement (options-only veto)", () => {
    const options = { decision: "ELIGIBLE" } as never;
    const v = applyUserPolicy({ decision: call, options, policy: DEFAULT_USER_RISK_POLICY, regularSession: true });
    assert.equal(v.withinUserPolicy, true);
    assert.equal(v.optionsWithinUserPolicy, false);
    assert.deepEqual(v.vetoes.map((x) => [x.code, x.scope]), [["OPTIONS_RISK_NOT_ACKNOWLEDGED", "OPTIONS"]]);
  });
  it("validation rejects malformed preferences", () => {
    assert.ok("errors" in validateUserRiskPolicy({ maxLossPerTrade: -5 }));
    assert.ok("errors" in validateUserRiskPolicy({ allowedInstruments: ["bad sym"] }));
    assert.ok("errors" in validateUserRiskPolicy({ maxLossPerTrade: 500, maxCapitalExposure: 100 }));
    assert.deepEqual(validateUserRiskPolicy({ allowedInstruments: ["TSLA", "TSLA", "NVDA"], sessionPreference: "REGULAR_HOURS_ONLY" }), {
      policy: { version: 1, maxCapitalExposure: null, maxLossPerTrade: null, allowedInstruments: ["NVDA", "TSLA"], sessionPreference: "REGULAR_HOURS_ONLY", optionsRiskAcknowledged: false },
    });
  });
});
