import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyDirection } from "../engine/direction.ts";
import { bullTargetFeed, END } from "../mtf-test-fixtures.ts";
import { buildMultiTimeframeState } from "./multi-timeframe.ts";

const POLICY = { macro: "1d", structure: "1h", setup: "15m", execution: "5m" } as const;
const feed = bullTargetFeed();

describe("MultiTimeframeState", () => {
  const m = buildMultiTimeframeState({ sessions: feed, now: END, policy: POLICY });
  it("has a TechnicalState per role, on the role's timeframe", () => {
    assert.equal(m.macro?.timeframe, "1d");
    assert.equal(m.structure?.timeframe, "1h");
    assert.equal(m.setup?.timeframe, "15m");
    assert.equal(m.execution?.timeframe, "5m");
    assert.equal(m.symbol, "TSLA");
    assert.equal(m.timestamp, END);
  });
  it("role directions reuse the canonical strict direction rule", () => {
    for (const r of m.roles) assert.equal(r.direction, r.state ? classifyDirection(r.state) : "NEUTRAL");
  });
  it("is synchronized with explicit reasons", () => {
    assert.equal(m.synchronized, true);
    assert.deepEqual(m.blockers, []);
    assert.match(m.reasons[0] ?? "", /bias/);
  });
  it("with refinement role (1m base) builds five roles", () => {
    // Each 5m bar re-expressed as five identical-close 1m bars keeps the aggregate exact.
    const oneMin = feed.map((s) => ({
      ...s,
      timeframe: "1m" as const,
      candles: s.candles.flatMap((c) =>
        Array.from({ length: 5 }, (_, k) => ({ ...c, timeframe: "1m" as const, timestamp: c.timestamp + k * 60_000, open: k === 0 ? c.open : c.close, high: k === 0 ? c.high : c.close, low: k === 0 ? c.low : c.close, volume: c.volume / 5 })),
      ),
    }));
    const r = buildMultiTimeframeState({ sessions: oneMin, now: END, policy: { ...POLICY, refinement: "1m" } });
    assert.equal(r.roles.length, 5);
    assert.equal(r.refinement?.timeframe, "1m");
    assert.equal(r.synchronized, true);
  });
  it("is deterministic and frozen", () => {
    assert.deepEqual(buildMultiTimeframeState({ sessions: structuredClone(feed), now: END, policy: POLICY }), m);
    assert.ok(Object.isFrozen(m) && Object.isFrozen(m.roles));
  });
});
