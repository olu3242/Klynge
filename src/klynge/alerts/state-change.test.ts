import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BULL_BARS } from "../setup-test-fixtures.ts";
import { evaluate } from "../triggers/trigger-test-helpers.ts";
import { evaluateVisualContext } from "../visual/visual-context.ts";
import { full, raw, session, T } from "../visual/visual-test-fixtures.ts";
import { detectDecisionChange, detectVisualChange } from "./state-change.ts";

describe("deterministic state-change alerts", () => {
  const wait = evaluate({ bars: BULL_BARS.slice(0, 26) });
  const call = evaluate();
  it("no change => no alert", () => assert.equal(detectDecisionChange(call, call), null));
  it("WAIT -> CALL_SETUP => ATTENTION with deterministic idempotency key", () => {
    const a = detectDecisionChange(wait, call)!;
    assert.equal(a.severity, "ATTENTION");
    assert.equal(a.alertId, `TSLA:DATA:WAIT->CALL_SETUP:${call.provenance.evaluatedAt}`);
    assert.deepEqual(detectDecisionChange(wait, call), a);
    assert.match(a.message, /Not a recommendation/);
  });
  it("active -> INVALIDATED => WARNING", () => {
    const inv = evaluate({ market: "mixed" }, { previous: call });
    assert.equal(detectDecisionChange(call, inv)?.severity, "WARNING");
  });
  it("first observation => INFO from NONE", () => assert.equal(detectDecisionChange(undefined, wait)?.alertId.includes("NONE->WAIT"), true));
  it("visual label/permission change alerts; never phrased as a setup", () => {
    const a = evaluateVisualContext(session([{ r: raw("TSLA") }]), T);
    const b = evaluateVisualContext(full("BULLISH", "BULLISH", "BULLISH"), T + 1);
    const alert = detectVisualChange(a, b)!;
    assert.equal(alert.evidenceMode, "VISUAL");
    assert.equal(alert.to, "BULLISH CONTEXT/WAIT");
    assert.doesNotMatch(alert.message, /SETUP/);
    assert.equal(detectVisualChange(b, b), null);
  });
});
