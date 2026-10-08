import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateVisualContext } from "../visual/visual-context.ts";
import { full, T } from "../visual/visual-test-fixtures.ts";
import { checkAgentJournalAction, checkAgentVisualClaim } from "./authority.ts";

const ctx = evaluateVisualContext(full("BULLISH", "BULLISH", "BULLISH"), T);

describe("agents and VISUAL evidence", () => {
  it("may explain the visual context", () => assert.equal(checkAgentVisualClaim(ctx, { agentId: "explainabilityAgent", action: "explain", label: "BULLISH CONTEXT", permission: "WAIT" }).ok, true));
  it("cannot upgrade VISUAL into CALL_SETUP / PUT_SETUP", () => {
    assert.equal(checkAgentVisualClaim(ctx, { agentId: "marketAgent", action: "summarize", decision: "CALL_SETUP" }).ok, false);
    assert.equal(checkAgentVisualClaim(ctx, { agentId: "marketAgent", action: "summarize", decision: "PUT_SETUP" }).ok, false);
  });
  it("cannot claim data verification or change the label", () => {
    assert.equal(checkAgentVisualClaim(ctx, { agentId: "contextAgent", action: "explain", claimsDataVerified: true }).ok, false);
    assert.equal(checkAgentVisualClaim(ctx, { agentId: "contextAgent", action: "explain", label: "BEARISH CONTEXT" }).ok, false);
  });
  it("journalAgent is explain/summarize-only and never mutates", () => {
    assert.equal(checkAgentJournalAction({ agentId: "journalAgent", action: "summarize", target: "USER_NOTE", mutates: false }).ok, true);
    assert.equal(checkAgentJournalAction({ agentId: "journalAgent", action: "edit", target: "USER_NOTE", mutates: true }).ok, false);
    assert.equal(checkAgentJournalAction({ agentId: "journalAgent", action: "explain", target: "ENGINE_RECORD", mutates: true }).ok, false);
  });
});
