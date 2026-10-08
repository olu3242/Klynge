import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bullTargetFeed, END } from "../mtf-test-fixtures.ts";
import { evaluateOptions } from "../options/eligibility.ts";
import { callSetup, chain, contract, NOW, UNDERLYING_PRICE } from "../options/options-test-fixtures.ts";
import { BULL_BARS } from "../setup-test-fixtures.ts";
import { buildMultiTimeframeState } from "../timeframe/multi-timeframe.ts";
import { evaluate } from "../triggers/trigger-test-helpers.ts";
import type { ReplayOutcome } from "../replay/types.ts";
import { checkAgentBiasClaim, checkAgentOptionsClaim, checkAgentReplayClaim } from "./authority.ts";

const mtf = buildMultiTimeframeState({ sessions: bullTargetFeed(), now: END, policy: { macro: "1d", structure: "1h", setup: "15m", execution: "5m" } });
const eligible = evaluateOptions({ setup: callSetup(), chain: chain([contract(), contract({ symbol: "POOR", volume: 1 })]), now: NOW, underlyingPrice: UNDERLYING_PRICE });
const waitOptions = evaluateOptions({ setup: evaluate({ bars: BULL_BARS.slice(0, 26) }), chain: chain([contract()]), now: NOW, underlyingPrice: UNDERLYING_PRICE });
const outcome: ReplayOutcome = { setupId: "s", decision: "CALL_SETUP", entered: true, targetReached: false, invalidationReached: true, realizedRewardRisk: -1, startedAt: 1, direction: "CALL" };

describe("agents cannot change higher-timeframe bias or override conflict", () => {
  it("may explain the engine bias", () => assert.equal(checkAgentBiasClaim(mtf, { agentId: "contextAgent", action: "explain", bias: mtf.bias }).ok, true));
  it("cannot change bias", () => assert.equal(checkAgentBiasClaim(mtf, { agentId: "contextAgent", action: "explain", bias: "BULLISH" }).ok, mtf.bias === "BULLISH"));
  it("cannot claim a CONFLICTED context is aligned", () => {
    const conflicted = { ...mtf, bias: "CONFLICTED" as const };
    assert.equal(checkAgentBiasClaim(conflicted, { agentId: "structureAgent", action: "summarize", bias: "BULLISH" }).ok, false);
  });
  it("cannot override synchronization", () => assert.equal(checkAgentBiasClaim({ ...mtf, synchronized: false }, { agentId: "marketAgent", action: "explain", synchronized: true }).ok, false));
});

describe("agents cannot bypass options rules", () => {
  it("may explain engine eligibility", () => {
    assert.equal(checkAgentOptionsClaim(eligible, { agentId: "optionsAgent", action: "explain", decision: "ELIGIBLE", eligibleContracts: [eligible.eligibleContracts[0]!.symbol] }).ok, true);
  });
  it("cannot turn a rejected contract into an eligible one (liquidity bypass)", () => {
    assert.equal(checkAgentOptionsClaim(eligible, { agentId: "optionsAgent", action: "explain", eligibleContracts: ["POOR"] }).ok, false);
  });
  it("cannot create eligibility without CALL_SETUP / PUT_SETUP", () => {
    assert.equal(waitOptions.decision, "WAIT");
    assert.equal(checkAgentOptionsClaim(waitOptions, { agentId: "optionsAgent", action: "summarize", decision: "ELIGIBLE" }).ok, false);
    const forged = { ...waitOptions, decision: "ELIGIBLE" as const };
    assert.equal(checkAgentOptionsClaim(forged, { agentId: "optionsAgent", action: "explain" }).ok, false);
  });
  it("cannot place orders or take non-permitted actions", () => assert.equal(checkAgentOptionsClaim(eligible, { agentId: "optionsAgent", action: "buy" }).ok, false));
  it("options results are immutable", () => {
    assert.throws(() => {
      (eligible.rejectedContracts as unknown[]).length = 0;
    }, TypeError);
  });
});

describe("agents cannot modify replay results", () => {
  it("may summarize an outcome faithfully", () => assert.equal(checkAgentReplayClaim(outcome, { agentId: "replayAgent", action: "summarize", invalidationReached: true, realizedRewardRisk: -1 }).ok, true));
  it("cannot rewrite a loss into a win", () => {
    assert.equal(checkAgentReplayClaim(outcome, { agentId: "replayAgent", action: "summarize", targetReached: true }).ok, false);
    assert.equal(checkAgentReplayClaim(outcome, { agentId: "journalAgent", action: "explain", realizedRewardRisk: 2 }).ok, false);
  });
});
