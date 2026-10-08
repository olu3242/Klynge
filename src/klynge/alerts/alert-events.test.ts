import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BULL_BARS } from "../setup-test-fixtures.ts";
import { evaluate } from "../triggers/trigger-test-helpers.ts";
import { evaluateVisualContext } from "../visual/visual-context.ts";
import { full, raw, session, T } from "../visual/visual-test-fixtures.ts";
import { detectDataVerified, detectDecisionChange, detectRegimeChange, detectVisualChange, providerFailureAlert } from "./state-change.ts";

describe("alert events reflect state; they never create it", () => {
  const wait = evaluate({ bars: BULL_BARS.slice(0, 26) });
  const call = evaluate();
  const mixed = evaluate({ market: "mixed" }, { previous: call });
  it("decision events: SETUP_WAIT / CALL_SETUP / INVALIDATED", () => {
    assert.equal(detectDecisionChange(undefined, wait)?.event, "SETUP_WAIT");
    assert.equal(detectDecisionChange(wait, call)?.event, "CALL_SETUP");
    assert.equal(detectDecisionChange(call, mixed)?.event, "INVALIDATED");
  });
  it("DATA_VERIFIED only on the first DATA decision of a lineage", () => {
    assert.equal(detectDataVerified(undefined, wait)?.event, "DATA_VERIFIED");
    assert.equal(detectDataVerified(wait, call), null);
  });
  it("regime events: RISK_ON → MIXED", () => {
    assert.equal(call.regime, "RISK_ON");
    const a = detectRegimeChange(call, mixed);
    assert.deepEqual([a?.event, a?.severity], ["MIXED", "WARNING"]);
    assert.equal(detectRegimeChange(call, call), null);
  });
  it("visual events: incomplete → complete; never phrased as a setup", () => {
    const a = evaluateVisualContext(session([{ r: raw("TSLA") }]), T);
    const b = evaluateVisualContext(full("BULLISH", "BULLISH", "BULLISH"), T + 1);
    assert.equal(detectVisualChange(undefined, a)?.event, "VISUAL_CONTEXT_INCOMPLETE");
    assert.equal(detectVisualChange(a, b)?.event, "VISUAL_CONTEXT_COMPLETE");
  });
  it("provider failure alert id is stable for the same failure + market state", () => {
    const f = [{ code: "STALE_DATA" as const, message: "x" }, { code: "MISSING_BARS" as const, message: "y" }];
    const a = providerFailureAlert("TSLA", f, "BLOCKED", 100, 1);
    const b = providerFailureAlert("TSLA", [...f].reverse(), "BLOCKED", 100, 999);
    assert.equal(a.alertId, b.alertId);
    assert.equal(a.alertId, "TSLA:DATA:PROVIDER_FAILURE:MISSING_BARS+STALE_DATA:100");
    assert.doesNotMatch(a.message, /CALL|PUT|buy|sell/i);
  });
});
