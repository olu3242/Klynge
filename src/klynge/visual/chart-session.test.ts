import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { missingContext } from "./missing-context.ts";
import { assignRole, roleForSymbol } from "./session.ts";
import { observation, raw, session, T } from "./visual-test-fixtures.ts";

describe("multi-chart session", () => {
  it("roles derive from the market-context policy", () => {
    assert.equal(roleForSymbol("SPX"), "SPX");
    assert.equal(roleForSymbol("MNQ"), "MNQ");
    assert.equal(roleForSymbol("SPY"), "VOLUME_PROXY");
    assert.equal(roleForSymbol("TSLA"), "TARGET");
    assert.equal(roleForSymbol(null), null);
  });
  it("user override accepted when consistent or symbol unknown", () => {
    assert.deepEqual(assignRole(observation(raw("SPX")), "SPX"), { role: "SPX", roleSource: "USER" });
    const unknown = observation(raw("TSLA", "BULLISH", { symbol: { value: null, status: "NOT_VISIBLE", confidence: 0.9, evidence: "" } }));
    assert.deepEqual(assignRole(unknown, "MNQ"), { role: "MNQ", roleSource: "USER" });
  });
  it("override that contradicts the symbol is a role violation", () => {
    const r = assignRole(observation(raw("TSLA")), "SPX");
    assert.equal(r.roleViolation, "TSLA cannot fill the SPX role");
  });
  it("capture time defaults to upload time", () => {
    const s = session([{ r: raw("TSLA"), at: T + 5 }]);
    assert.equal(s.charts[0]!.captureTime, T + 5);
    assert.equal(s.charts[0]!.captureTimeSource, "UPLOAD");
  });
  it("one chart per role: a newer upload replaces the older one", () => {
    const s = session([{ r: raw("SPX", "BEARISH"), id: "a" }, { r: raw("SPX", "BULLISH"), id: "b" }]);
    assert.deepEqual(s.charts.map((c) => c.chartId), ["b"]);
  });
  it("completeness: TSLA ✓ SPX missing MNQ missing → COMPLETE", () => {
    const one = missingContext(session([{ r: raw("TSLA") }]));
    assert.deepEqual(one.charts.map((c) => [c.role, c.present]), [["TARGET", true], ["SPX", false], ["MNQ", false]]);
    assert.deepEqual(one.nextSteps, ["+ Add SPX chart", "+ Add MNQ chart"]);
    assert.equal(missingContext(session([{ r: raw("TSLA") }, { r: raw("SPX") }, { r: raw("MNQ") }])).complete, true);
  });
  it("missing required fields are listed per chart", () => {
    const r = missingContext(session([{ r: raw("TSLA", "BULLISH", { lastPrice: { value: null, status: "NOT_VISIBLE", confidence: 0.9, evidence: "" } }) }, { r: raw("SPX") }, { r: raw("MNQ") }]));
    assert.deepEqual(r.fields, [{ role: "TARGET", field: "lastPrice", status: "NOT_VISIBLE" }]);
    assert.equal(r.complete, false);
  });
});
