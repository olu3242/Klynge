import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BULL_BARS } from "../setup-test-fixtures.ts";
import { evaluate, FAILED_RETEST } from "../triggers/trigger-test-helpers.ts";
import { validateDecisionState } from "../triggers/invariants.ts";
import { checkAgentSetupClaim } from "./authority.ts";

const wait = evaluate({ bars: BULL_BARS.slice(0, 26) });
const blocked = evaluate({ market: "mixed" });
const invalidated = evaluate({ bars: FAILED_RETEST });
const call = evaluate();

describe("agent setup boundary", () => {
  it("fixtures cover WAIT / BLOCKED / INVALIDATED / CALL_SETUP", () => {
    assert.deepEqual([wait.decision, blocked.decision, invalidated.decision, call.decision], ["WAIT", "BLOCKED", "INVALIDATED", "CALL_SETUP"]);
  });
  it("agents may explain and monitor consistent state", () => {
    assert.equal(checkAgentSetupClaim(wait, { agentId: "explainabilityAgent", action: "explain", decision: "WAIT", priceActionState: "ACCEPTED" }).ok, true);
    assert.equal(checkAgentSetupClaim(call, { agentId: "riskAgent", action: "monitor", decision: "CALL_SETUP", riskAllowed: true }).ok, true);
  });
  it("cannot transform WAIT -> CALL_SETUP", () => assert.equal(checkAgentSetupClaim(wait, { agentId: "confirmationAgent", action: "explain", decision: "CALL_SETUP" }).ok, false));
  it("cannot transform WAIT -> PUT_SETUP", () => assert.equal(checkAgentSetupClaim(wait, { agentId: "marketAgent", action: "summarize", decision: "PUT_SETUP" }).ok, false));
  it("cannot transform BLOCKED -> setup", () => assert.equal(checkAgentSetupClaim(blocked, { agentId: "riskAgent", action: "explain", decision: "CALL_SETUP" }).ok, false));
  it("cannot transform INVALIDATED -> active", () => {
    assert.equal(checkAgentSetupClaim(invalidated, { agentId: "structureAgent", action: "explain", decision: "WAIT" }).ok, false);
    assert.equal(checkAgentSetupClaim(invalidated, { agentId: "structureAgent", action: "explain", priceActionState: "CONFIRMED" }).ok, false);
  });
  it("cannot claim confirmation or risk approval the engine did not grant", () => {
    assert.equal(checkAgentSetupClaim(wait, { agentId: "confirmationAgent", action: "explain", confirmationState: "CONFIRMED" }).ok, false);
    assert.equal(checkAgentSetupClaim(blocked, { agentId: "riskAgent", action: "explain", riskAllowed: true }).ok, false);
  });
  it("cannot take non-permitted actions", () => assert.equal(checkAgentSetupClaim(call, { agentId: "alertAgent", action: "place_order" }).ok, false));
  it("a forged directional state is detected", () => {
    const forged = { ...wait, decision: "CALL_SETUP" as const };
    assert.ok(validateDecisionState(forged).length > 0);
    assert.equal(checkAgentSetupClaim(forged, { agentId: "explainabilityAgent", action: "explain", decision: "CALL_SETUP" }).ok, false);
  });
  it("engine states are immutable to agents", () => {
    assert.throws(() => {
      (wait as { decision: string }).decision = "CALL_SETUP";
    }, TypeError);
    assert.throws(() => {
      (wait.progress as { confirmation: boolean }).confirmation = true;
    }, TypeError);
    assert.equal(wait.decision, "WAIT");
  });
});
