import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateOptions } from "../options/eligibility.ts";
import { bullTargetFeed, END, trendFeed } from "../mtf-test-fixtures.ts";
import { validateDecisionState } from "../triggers/invariants.ts";
import { evaluate } from "../triggers/trigger-test-helpers.ts";
import { full, T } from "../visual/visual-test-fixtures.ts";
import { buildDataSnapshot, buildVisualSnapshot, evaluateSnapshot } from "./snapshot.ts";

const POLICY = { macro: "1d", structure: "1h", setup: "15m", execution: "5m" } as const;
const data = { target: bullTargetFeed(), spx: trendFeed("SPX", 0.05, 5000), mnq: trendFeed("MNQ", 0.05, 18000), timeframePolicy: POLICY };

describe("canonical snapshot builder + router", () => {
  it("VISUAL snapshot keeps field provenance; DATA snapshot fields are DATA_VERIFIED", () => {
    const v = buildVisualSnapshot(full("BULLISH", "BULLISH", "BULLISH"), T);
    assert.equal(v.evidenceMode, "VISUAL");
    assert.equal(v.fields["TARGET.symbol"]?.provenance, "OBSERVED");
    assert.equal(v.snapshotId, `s1:VISUAL:${T}`);
    const d = buildDataSnapshot("s1", data, END);
    assert.equal(d.fields["TARGET.lastPrice"]?.provenance, "DATA_VERIFIED");
    assert.deepEqual(Object.keys(d.captureTimes).sort(), ["MNQ", "SPX", "TARGET"]);
  });
  it("VISUAL routes to visual context only — no setup decision, no options", () => {
    const r = evaluateSnapshot(buildVisualSnapshot(full("BULLISH", "BULLISH", "BULLISH"), T), { now: T });
    assert.equal(r.evidenceMode, "VISUAL");
    assert.ok(r.evidenceMode === "VISUAL" && r.context.label === "BULLISH CONTEXT");
    assert.equal("result" in r, false);
  });
  it("DATA routes to the existing deterministic pipeline unchanged => CALL_SETUP (evidenceMode DATA)", () => {
    const r = evaluateSnapshot(buildDataSnapshot("s1", data, END), { now: END });
    assert.ok(r.evidenceMode === "DATA");
    assert.equal(r.result.setup.decision, "CALL_SETUP");
    assert.equal(r.result.setup.evidenceMode, "DATA");
  });
  it("snapshots without their payload are rejected", () => {
    const v = buildVisualSnapshot(full("BULLISH", "BULLISH", "BULLISH"), T);
    assert.throws(() => evaluateSnapshot({ ...v, evidenceMode: "DATA" }, { now: T }), RangeError);
  });
});

describe("VISUAL can never pretend to be DATA (invariant)", () => {
  const call = evaluate();
  it("every engine decision is DATA evidence", () => assert.equal(call.evidenceMode, "DATA"));
  it("validateDecisionState rejects a CALL_SETUP carrying VISUAL evidence", () => {
    const forged = { ...call, evidenceMode: "VISUAL" as const };
    assert.ok(validateDecisionState(forged).some((v) => v.includes("DATA evidence")));
  });
  it("evaluateOptions blocks VISUAL evidence even with a CALL_SETUP label", () => {
    const forged = { ...call, evidenceMode: "VISUAL" as const };
    const r = evaluateOptions({ setup: forged, chain: { underlying: "TSLA", timestamp: T, contracts: [] }, now: T, underlyingPrice: 100 });
    assert.equal(r.decision, "BLOCKED");
    assert.deepEqual(r.blockers, ["VISUAL_EVIDENCE"]);
  });
});
