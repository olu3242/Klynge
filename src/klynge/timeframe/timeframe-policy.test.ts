import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { activeRoles, assertValidTimeframePolicy, baseTimeframe, DEFAULT_TIMEFRAME_POLICY, roleTimeframe, TIMEFRAME_ROLES } from "./hierarchy.ts";

describe("timeframe hierarchy", () => {
  it("canonical roles, highest authority first", () => assert.deepEqual([...TIMEFRAME_ROLES], ["MACRO", "STRUCTURE", "SETUP", "EXECUTION", "REFINEMENT"]));
  it("default policy: 1d / 1h / 15m / 5m / 1m", () => {
    assert.deepEqual({ ...DEFAULT_TIMEFRAME_POLICY }, { macro: "1d", structure: "1h", setup: "15m", execution: "5m", refinement: "1m" });
    assert.doesNotThrow(() => assertValidTimeframePolicy(DEFAULT_TIMEFRAME_POLICY));
  });
  it("base timeframe is the finest role (refinement when present, else execution)", () => {
    assert.equal(baseTimeframe(DEFAULT_TIMEFRAME_POLICY), "1m");
    assert.equal(baseTimeframe({ macro: "1d", structure: "1h", setup: "15m", execution: "5m" }), "5m");
  });
  it("refinement is optional", () => {
    assert.deepEqual(activeRoles({ macro: "1d", structure: "1h", setup: "15m", execution: "5m" }), ["MACRO", "STRUCTURE", "SETUP", "EXECUTION"]);
    assert.equal(roleTimeframe({ macro: "1d", structure: "1h", setup: "15m", execution: "5m" }, "REFINEMENT"), undefined);
  });
  it("configurable (e.g. 4h structure, 30m setup)", () => {
    assert.doesNotThrow(() => assertValidTimeframePolicy({ macro: "1d", structure: "4h", setup: "30m", execution: "5m" }));
  });
  it("rejects non-descending hierarchies", () => {
    assert.throws(() => assertValidTimeframePolicy({ macro: "1h", structure: "1d", setup: "15m", execution: "5m" }), RangeError);
    assert.throws(() => assertValidTimeframePolicy({ macro: "1d", structure: "1h", setup: "5m", execution: "5m" }), RangeError);
  });
  it("rejects roles that are not multiples of the base", () => {
    assert.throws(() => assertValidTimeframePolicy({ macro: "1d", structure: "1h", setup: "15m", execution: "5m", refinement: "4h" as never }), RangeError);
  });
  it("1d is only valid for MACRO/STRUCTURE", () => {
    assert.throws(() => assertValidTimeframePolicy({ macro: "1d", structure: "1d", setup: "15m", execution: "5m" }), RangeError); // also non-descending
  });
});
