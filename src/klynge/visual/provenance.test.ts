import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyConfirmation, ConfirmationError, confirmInSession } from "./confirmation.ts";
import { evaluateVisualContext } from "./visual-context.ts";
import { raw, session, T } from "./visual-test-fixtures.ts";

const s = session([{ r: raw("TSLA", "BULLISH", { structure: { value: "HH_HL", status: "OBSERVED", confidence: 0.5, evidence: "unclear" } }) }]);
const entry = s.charts[0]!;

describe("provenance transitions + human confirmation", () => {
  it("low-confidence observation starts NOT_VERIFIED", () => assert.equal(entry.observation.structure.status, "NOT_VERIFIED"));
  it("CONFIRM: NOT_VERIFIED/OBSERVED -> USER_CONFIRMED with immutable audit", () => {
    const c = applyConfirmation(entry, { field: "structure", action: "CONFIRM" }, "user-1", T + 1);
    assert.equal(c.observation.structure.status, "USER_CONFIRMED");
    assert.equal(c.audit.length, 1);
    assert.equal(c.audit[0]!.original.status, "NOT_VERIFIED");
    assert.equal(c.audit[0]!.actor, "user-1");
    assert.equal(c.audit[0]!.at, T + 1);
    assert.equal(entry.observation.structure.status, "NOT_VERIFIED"); // original untouched
    assert.ok(Object.isFrozen(c.audit));
  });
  it("EDIT replaces the value -> USER_CONFIRMED (records original vs edited)", () => {
    const c = applyConfirmation(entry, { field: "lastPrice", action: "EDIT", value: 101.5 }, "user-1", T);
    assert.equal(c.observation.lastPrice.value, 101.5);
    assert.equal(c.observation.lastPrice.status, "USER_CONFIRMED");
    assert.equal(c.audit[0]!.original.value, 100);
  });
  it("USER_CONFIRMED never becomes DATA_VERIFIED", () => {
    let c = applyConfirmation(entry, { field: "symbol", action: "CONFIRM" }, "u", T);
    c = applyConfirmation(c, { field: "symbol", action: "CONFIRM" }, "u", T + 1);
    assert.equal(c.observation.symbol.status, "USER_CONFIRMED");
    assert.ok(c.audit.every((a) => a.confirmed.status === "USER_CONFIRMED"));
  });
  it("invalid edits and empty confirmations are rejected", () => {
    assert.throws(() => applyConfirmation(entry, { field: "timeframe", action: "EDIT", value: "7m" }, "u", T), ConfirmationError);
    assert.throws(() => applyConfirmation(entry, { field: "chartTime", action: "CONFIRM" }, "u", T), ConfirmationError);
    assert.throws(() => applyConfirmation(entry, { field: "symbol", action: "CONFIRM" }, "  ", T), ConfirmationError);
  });
  it("confirmed axis time becomes the capture time", () => {
    const c = applyConfirmation(entry, { field: "chartTime", action: "EDIT", value: T - 60_000 }, "u", T);
    assert.equal(c.captureTime, T - 60_000);
    assert.equal(c.captureTimeSource, "AXIS_CONFIRMED");
  });
  it("editing the symbol re-detects the role", () => {
    const c = applyConfirmation(entry, { field: "symbol", action: "EDIT", value: "SPX" }, "u", T);
    assert.equal(c.role, "SPX");
  });
  it("confirmation can unblock INSUFFICIENT context but never produces a setup", () => {
    const three = session([{ r: raw("TSLA", "BULLISH", { structure: { value: "HH_HL", status: "OBSERVED", confidence: 0.5, evidence: "" } }) }, { r: raw("SPX") }, { r: raw("MNQ") }]);
    assert.equal(evaluateVisualContext(three, T).label, "INSUFFICIENT CONTEXT");
    const fixed = confirmInSession(three, three.charts[0]!.chartId, { field: "structure", action: "CONFIRM" }, "u", T);
    const ctx = evaluateVisualContext(fixed, T);
    assert.equal(ctx.label, "BULLISH CONTEXT");
    assert.equal(ctx.permission, "WAIT");
    assert.doesNotMatch(JSON.stringify(ctx), /CALL_SETUP|PUT_SETUP|DATA_VERIFIED/);
  });
});
