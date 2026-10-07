import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Candle } from "../domain/types.ts";
import { DEFAULT_DATA_QUALITY_POLICY, TECHNICAL_REQUIRED_CANDLES } from "../policies/data-quality-policy.ts";
import { FIVE_MIN, makeCandles, makeSession, nowAfter, T0, withCandle } from "../test-fixtures.ts";
import { validateCandle } from "./candle-validation.ts";
import { assessSeriesQuality, assessSessionQuality, assessSnapshotSync, mergeDataQuality } from "./series-quality.ts";

const good: Candle = { symbol: "SPX", timeframe: "5m", timestamp: T0, open: 10, high: 12, low: 9, close: 11, volume: 100 };
const codes = (c: Candle) => validateCandle(c).map((i) => i.code);

describe("validateCandle", () => {
  it("accepts a well-formed candle", () => assert.deepEqual(codes(good), []));
  it("rejects high < low", () => assert.ok(codes({ ...good, high: 8, low: 9, open: 8.5, close: 8.5 }).includes("HIGH_BELOW_LOW")));
  it("rejects open > high", () => assert.deepEqual(codes({ ...good, open: 13 }), ["OPEN_ABOVE_HIGH"]));
  it("rejects open < low", () => assert.deepEqual(codes({ ...good, open: 8 }), ["OPEN_BELOW_LOW"]));
  it("rejects close > high", () => assert.deepEqual(codes({ ...good, close: 13 }), ["CLOSE_ABOVE_HIGH"]));
  it("rejects close < low", () => assert.deepEqual(codes({ ...good, close: 8 }), ["CLOSE_BELOW_LOW"]));
  it("rejects negative volume", () => assert.deepEqual(codes({ ...good, volume: -1 }), ["NEGATIVE_VOLUME"]));
  it("rejects NaN price", () => assert.deepEqual(codes({ ...good, close: NaN }), ["NON_FINITE_PRICE"]));
  it("rejects Infinity price", () => assert.deepEqual(codes({ ...good, high: Infinity }), ["NON_FINITE_PRICE"]));
  it("rejects NaN volume", () => assert.deepEqual(codes({ ...good, volume: NaN }), ["NON_FINITE_VOLUME"]));
  it("rejects Infinity volume", () => assert.deepEqual(codes({ ...good, volume: Infinity }), ["NON_FINITE_VOLUME"]));
  it("rejects empty symbol", () => assert.deepEqual(codes({ ...good, symbol: "  " }), ["EMPTY_SYMBOL"]));
  it("rejects invalid timestamps", () => {
    for (const timestamp of [0, -1, 1.5, NaN, Infinity]) assert.deepEqual(codes({ ...good, timestamp }), ["INVALID_TIMESTAMP"]);
  });
  it("rejects invalid timeframe", () => assert.deepEqual(codes({ ...good, timeframe: "2m" as never }), ["INVALID_TIMEFRAME"]));
});

describe("assessSeriesQuality", () => {
  const candles = makeCandles();
  const now = (candles.at(-1) as Candle).timestamp + FIVE_MIN;

  it("passes a clean, closed, contiguous series", () => {
    const dq = assessSeriesQuality(candles, { now });
    assert.equal(dq.valid, true);
    assert.deepEqual(dq.blockers, []);
  });
  it("NO_DATA for an empty series", () => {
    const dq = assessSeriesQuality([], { now });
    assert.equal(dq.valid, false);
    assert.equal(dq.sufficientHistory, false);
    assert.ok(dq.blockers.includes("NO_DATA"));
  });
  it("flags malformed OHLC", () => {
    const bad = candles.map((c, i) => (i === 5 ? { ...c, close: c.high + 1 } : c));
    const dq = assessSeriesQuality(bad, { now });
    assert.equal(dq.malformedOHLC, true);
    assert.ok(dq.blockers.includes("MALFORMED_OHLC"));
  });
  it("flags negative volume", () => {
    const dq = assessSeriesQuality(candles.map((c, i) => (i === 3 ? { ...c, volume: -5 } : c)), { now });
    assert.equal(dq.negativeVolume, true);
    assert.equal(dq.valid, false);
  });
  it("flags NaN and Infinity", () => {
    for (const v of [NaN, Infinity, -Infinity]) {
      const dq = assessSeriesQuality(candles.map((c, i) => (i === 4 ? { ...c, low: v } : c)), { now });
      assert.equal(dq.malformedOHLC, true);
      assert.equal(dq.valid, false);
    }
  });
  it("flags duplicate timestamps", () => {
    const dup = [...candles.slice(0, 10), { ...(candles[9] as Candle) }, ...candles.slice(10)];
    const dq = assessSeriesQuality(dup, { now });
    assert.equal(dq.duplicateTimestamps, true);
    assert.ok(dq.blockers.includes("DUPLICATE_TIMESTAMPS"));
  });
  it("flags out-of-order timestamps", () => {
    const swapped = [...candles];
    [swapped[7], swapped[8]] = [swapped[8] as Candle, swapped[7] as Candle];
    const dq = assessSeriesQuality(swapped, { now });
    assert.equal(dq.outOfOrder, true);
    assert.ok(dq.blockers.includes("OUT_OF_ORDER"));
  });
  it("flags mixed symbols", () => {
    const dq = assessSeriesQuality(candles.map((c, i) => (i === 2 ? { ...c, symbol: "MNQ" } : c)), { now });
    assert.ok(dq.blockers.includes("MIXED_SERIES"));
    assert.equal(dq.valid, false);
  });
  it("flags mixed timeframes", () => {
    const dq = assessSeriesQuality(candles.map((c, i) => (i === 2 ? { ...c, timeframe: "1m" as const } : c)), { now });
    assert.ok(dq.blockers.includes("MIXED_SERIES"));
  });
  it("flags missing candles (gap)", () => {
    const gapped = candles.filter((_, i) => i !== 12);
    const dq = assessSeriesQuality(gapped, { now });
    assert.equal(dq.missingCandles, true);
    assert.ok(dq.blockers.includes("MISSING_CANDLES"));
  });
  it("flags misaligned timestamps", () => {
    const dq = assessSeriesQuality(candles.map((c, i) => (i >= 10 ? { ...c, timestamp: c.timestamp + 1000 } : c)), { now: now + 1000 });
    assert.ok(dq.blockers.includes("BAD_DATA"));
  });
  it("flags insufficient history", () => {
    const dq = assessSeriesQuality(candles.slice(0, TECHNICAL_REQUIRED_CANDLES - 1), { now: T0 + (TECHNICAL_REQUIRED_CANDLES - 1) * FIVE_MIN });
    assert.equal(dq.sufficientHistory, false);
    assert.ok(dq.blockers.includes("INSUFFICIENT_HISTORY"));
  });
  it("cannot configure history below the technical floor", () => {
    const policy = { ...DEFAULT_DATA_QUALITY_POLICY, minimumTechnicalCandles: 2 };
    const dq = assessSeriesQuality(candles.slice(0, 5), { now: T0 + 5 * FIVE_MIN, policy });
    assert.equal(dq.sufficientHistory, false);
  });
  it("honors a stricter history policy", () => {
    const policy = { ...DEFAULT_DATA_QUALITY_POLICY, minimumTechnicalCandles: 100 };
    assert.equal(assessSeriesQuality(candles, { now, policy }).sufficientHistory, false);
  });
  it("flags stale data using the explicit clock", () => {
    const limit = now + FIVE_MIN + DEFAULT_DATA_QUALITY_POLICY.maxStalenessMs;
    assert.equal(assessSeriesQuality(candles, { now: limit }).stale, false);
    const dq = assessSeriesQuality(candles, { now: limit + 1 });
    assert.equal(dq.stale, true);
    assert.ok(dq.blockers.includes("STALE_DATA"));
  });
  it("staleness respects policy", () => {
    const policy = { ...DEFAULT_DATA_QUALITY_POLICY, maxStalenessMs: 0 };
    assert.equal(assessSeriesQuality(candles, { now: now + FIVE_MIN + 1, policy }).stale, true);
  });
  it("rejects candles not yet closed at `now` (no lookahead)", () => {
    const dq = assessSeriesQuality(candles, { now: now - 1 });
    assert.ok(dq.blockers.includes("INCOMPLETE_CANDLE"));
    assert.equal(dq.valid, false);
  });
  it("rejects a non-finite clock", () => assert.equal(assessSeriesQuality(candles, { now: NaN }).valid, false));
  it("rejects an invalid policy", () => {
    assert.throws(() => assessSeriesQuality(candles, { now, policy: { ...DEFAULT_DATA_QUALITY_POLICY, maxStalenessMs: -1 } }), RangeError);
  });
});

describe("assessSessionQuality", () => {
  const session = makeSession();
  const now = nowAfter(session);
  it("passes a clean session", () => assert.equal(assessSessionQuality(session, { now }).valid, true));
  it("flags missing candles at session open", () => {
    const dq = assessSessionQuality({ ...session, openTimestamp: T0 - FIVE_MIN }, { now });
    assert.equal(dq.missingCandles, true);
  });
  it("flags candles outside the session", () => {
    const dq = assessSessionQuality({ ...session, closeTimestamp: T0 + 10 * FIVE_MIN }, { now });
    assert.ok(dq.blockers.includes("BAD_DATA"));
  });
  it("flags invalid session boundaries", () => {
    assert.equal(assessSessionQuality({ ...session, closeTimestamp: session.openTimestamp }, { now }).valid, false);
  });
  it("flags candles that do not match the session symbol", () => {
    assert.ok(assessSessionQuality({ ...session, symbol: "MNQ" }, { now }).blockers.includes("MIXED_SERIES"));
  });
  it("flags a malformed candle within a session", () => {
    assert.equal(assessSessionQuality(withCandle(session, 3, { open: 1e9 }), { now }).malformedOHLC, true);
  });
});

describe("assessSnapshotSync", () => {
  const skew = DEFAULT_DATA_QUALITY_POLICY.maxMarketSnapshotSkewMs;
  it("passes at exactly the skew limit", () => {
    assert.equal(assessSnapshotSync([{ label: "SPX", timestamp: T0 }, { label: "MNQ", timestamp: T0 + skew }]).timestampSkew, false);
  });
  it("flags skew beyond the limit", () => {
    const dq = assessSnapshotSync([{ label: "SPX", timestamp: T0 }, { label: "MNQ", timestamp: T0 + skew + 1 }]);
    assert.equal(dq.timestampSkew, true);
    assert.deepEqual(dq.blockers, ["TIMESTAMP_SKEW"]);
  });
  it("skew threshold is configurable", () => {
    const policy = { ...DEFAULT_DATA_QUALITY_POLICY, maxMarketSnapshotSkewMs: 1000 };
    assert.equal(assessSnapshotSync([{ label: "SPX", timestamp: T0 }, { label: "MNQ", timestamp: T0 + 1001 }], policy).timestampSkew, true);
  });
  it("NO_DATA when snapshots are missing", () => assert.ok(assessSnapshotSync([]).blockers.includes("NO_DATA")));
});

describe("mergeDataQuality", () => {
  it("fails if any input fails, preserving blockers in order", () => {
    const a = assessSnapshotSync([{ label: "A", timestamp: T0 }, { label: "B", timestamp: T0 + 10 * 60_000 }]);
    const b = assessSeriesQuality([], { now: T0 });
    const m = mergeDataQuality(a, b);
    assert.equal(m.valid, false);
    assert.equal(m.timestampSkew, true);
    assert.equal(m.sufficientHistory, false);
    assert.deepEqual(m.blockers, ["TIMESTAMP_SKEW", "NO_DATA", "INSUFFICIENT_HISTORY"]);
  });
  it("empty merge is NO_DATA (fail-closed)", () => assert.ok(mergeDataQuality().blockers.includes("NO_DATA")));
});
