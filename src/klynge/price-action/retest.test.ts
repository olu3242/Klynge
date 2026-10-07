import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ABOVE, BELOW, BREAK, CONTINUATION, mirror, run, RETEST } from "./pa-test-helpers.ts";
import type { OHLC } from "./pa-test-helpers.ts";

const ACCEPTED: OHLC[] = [BELOW, BREAK, ABOVE, ABOVE];

describe("retest", () => {
  it("valid bullish retest => RETESTING", () => {
    const r = run([...ACCEPTED, RETEST]);
    assert.equal(r.state, "RETESTING");
    assert.equal(r.lifecycles[0]?.retestExtreme, 100.25);
  });
  it("valid bearish retest => RETESTING", () => assert.equal(run(mirror([...ACCEPTED, RETEST]), "BEARISH").state, "RETESTING"));
  it("ATR tolerance: low just outside tolerance is not a retest", () => {
    assert.equal(run([...ACCEPTED, [100.75, 100.75, 100.2501, 100.5]]).state, "ACCEPTED");
  });
  it("retest does not require exact price equality", () => assert.equal(run([...ACCEPTED, [100.75, 100.75, 100.1, 100.5]]).state, "RETESTING"));
  it("no retest => stays ACCEPTED", () => assert.equal(run([...ACCEPTED, ABOVE, ABOVE]).state, "ACCEPTED"));
  it("retest probing within maximum depth is allowed", () => assert.equal(run([...ACCEPTED, [100.75, 100.75, 99.5, 100.25]]).state, "RETESTING"));
  it("retest too deep => FAILED", () => {
    const r = run([...ACCEPTED, [100.75, 100.75, 99.4999, 100.25]]);
    assert.equal(r.state, "FAILED");
    assert.match(r.lifecycles[0]?.endReason ?? "", /too deep/);
  });
  it("failed bullish retest (material close back through) => FAILED", () => {
    const r = run([...ACCEPTED, RETEST, [100.5, 100.5, 99.6, 99.75]]);
    assert.equal(r.state, "FAILED");
    assert.match(r.lifecycles[0]?.endReason ?? "", /Failed retest/);
  });
  it("failed bearish retest => FAILED", () => assert.equal(run(mirror([...ACCEPTED, RETEST, [100.5, 100.5, 99.6, 99.75]]), "BEARISH").state, "FAILED"));
  it("continuation after retest => CONFIRMED with structural invalidation", () => {
    const r = run([...ACCEPTED, RETEST, CONTINUATION]);
    assert.equal(r.state, "CONFIRMED");
    assert.equal(r.lifecycles[0]?.invalidation, 99.75); // min(100, 100.25) − 0.25 × ATR
  });
  it("bearish continuation => CONFIRMED, invalidation above", () => {
    const r = run(mirror([...ACCEPTED, RETEST, CONTINUATION]), "BEARISH");
    assert.equal(r.state, "CONFIRMED");
    assert.equal(r.lifecycles[0]?.invalidation, 100.25);
  });
});
