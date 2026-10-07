import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { atr } from "../indicators/atr.ts";
import { ema, emaSlope } from "../indicators/ema.ts";
import { sessionVwap } from "../indicators/vwap.ts";
import { makeSession, nowAfter, withCandle } from "../test-fixtures.ts";
import { buildTechnicalState } from "./technical-state.ts";

describe("buildTechnicalState", () => {
  const session = makeSession({ trend: "up", lastVolume: 1600 });
  const now = nowAfter(session);

  it("builds every field from the canonical indicators", () => {
    const r = buildTechnicalState(session, { now });
    assert.ok(r.ok);
    const closes = session.candles.map((c) => c.close);
    const e = ema(closes, 9);
    assert.equal(r.state.symbol, "SPX");
    assert.equal(r.state.timeframe, "5m");
    assert.equal(r.state.timestamp, session.candles.at(-1)?.timestamp);
    assert.equal(r.state.price, closes.at(-1));
    assert.equal(r.state.ema9, e.at(-1));
    assert.equal(r.state.ema9Slope, emaSlope(e));
    assert.equal(r.state.atr14, atr(session.candles, 14));
    assert.equal(r.state.vwap, sessionVwap(session));
    assert.equal(r.state.volume, 1600);
    assert.equal(r.state.averageVolume20, 1000);
    assert.equal(r.state.volumeRatio, 1.6);
    assert.equal(r.state.structure, "HH_HL");
  });

  it("does not calculate from invalid input", () => {
    const r = buildTechnicalState(withCandle(session, 10, { high: 0 }), { now });
    assert.equal(r.ok, false);
    assert.equal("state" in r, false);
    assert.equal(r.dataQuality.malformedOHLC, true);
  });

  it("fails on stale data", () => {
    const r = buildTechnicalState(session, { now: now + 60 * 60_000 });
    assert.equal(r.ok, false);
    assert.ok(r.dataQuality.blockers.includes("STALE_DATA"));
  });

  it("fails on insufficient history", () => {
    const short = { ...session, candles: session.candles.slice(0, 15) };
    const r = buildTechnicalState(short, { now: nowAfter(short) });
    assert.equal(r.ok, false);
    assert.equal(r.dataQuality.sufficientHistory, false);
  });

  it("fails when session VWAP is undefined (zero volume)", () => {
    const zero = makeSession({ volume: 0 });
    const r = buildTechnicalState(zero, { now: nowAfter(zero) });
    assert.equal(r.ok, false);
    assert.ok(r.dataQuality.blockers.includes("BAD_DATA"));
  });

  it("is deterministic and frozen", () => {
    const a = buildTechnicalState(session, { now });
    const b = buildTechnicalState(structuredClone(session), { now });
    assert.deepEqual(a, b);
    assert.ok(Object.isFrozen(a));
    assert.ok(a.ok && Object.isFrozen(a.state));
  });

  it("does not mutate its input", () => {
    const copy = structuredClone(session);
    buildTechnicalState(session, { now });
    assert.deepEqual(session, copy);
  });
});
