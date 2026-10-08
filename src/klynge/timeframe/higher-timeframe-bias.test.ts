import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Direction } from "../domain/types.ts";
import { END, trendFeed } from "../mtf-test-fixtures.ts";
import { deriveHigherTimeframeBias } from "./bias.ts";
import { buildMultiTimeframeState } from "./multi-timeframe.ts";

const POLICY = { macro: "1d", structure: "1h", setup: "15m", execution: "5m" } as const;

describe("higher-timeframe bias (explicit table)", () => {
  const table: [Direction, Direction, string][] = [
    ["BULLISH", "BULLISH", "BULLISH"],
    ["BEARISH", "BEARISH", "BEARISH"],
    ["BULLISH", "BEARISH", "CONFLICTED"],
    ["BEARISH", "BULLISH", "CONFLICTED"],
    ["BULLISH", "NEUTRAL", "NEUTRAL"],
    ["NEUTRAL", "BULLISH", "NEUTRAL"],
    ["BEARISH", "NEUTRAL", "NEUTRAL"],
    ["NEUTRAL", "BEARISH", "NEUTRAL"],
    ["NEUTRAL", "NEUTRAL", "NEUTRAL"],
  ];
  for (const [macro, structure, bias] of table) it(`macro ${macro} + structure ${structure} => ${bias}`, () => assert.equal(deriveHigherTimeframeBias(macro, structure), bias));
});

describe("bias from real derived data (existing TechnicalState + structure rules)", () => {
  it("bullish macro + bullish structure => BULLISH", () => {
    const m = buildMultiTimeframeState({ sessions: trendFeed("X", 0.05, 500, undefined, { dayWave: 5, dayPeriod: 28 * 6, barWave: 1.2, phase: 0 }), now: END, policy: POLICY });
    assert.equal(m.roles.find((r) => r.role === "MACRO")?.direction, "BULLISH");
    assert.equal(m.roles.find((r) => r.role === "STRUCTURE")?.direction, "BULLISH");
    assert.equal(m.bias, "BULLISH");
  });
  it("bearish macro + bearish structure => BEARISH", () => {
    const m = buildMultiTimeframeState({ sessions: trendFeed("X", -0.05, 500, undefined, { dayWave: 3, dayPeriod: 28 * 5, barWave: 1.2, phase: 0 }), now: END, policy: POLICY });
    assert.equal(m.bias, "BEARISH");
  });
  it("unsynchronized context never yields a directional bias", () => {
    const m = buildMultiTimeframeState({ sessions: trendFeed("X", 0.05, 500).slice(-5), now: END, policy: POLICY }); // < 21 daily candles
    assert.equal(m.synchronized, false);
    assert.equal(m.bias, "NEUTRAL");
    assert.ok(m.blockers.includes("INSUFFICIENT_HISTORY"));
  });
});
