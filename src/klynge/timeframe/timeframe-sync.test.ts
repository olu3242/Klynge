import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { asOfFeed, bullTargetFeed, dayOpen, END, HISTORY_DAYS, M15, M5 } from "../mtf-test-fixtures.ts";
import { buildMultiTimeframeState } from "./multi-timeframe.ts";
import { resampleSession } from "./resample.ts";
import { DEFAULT_TIMEFRAME_SYNC_POLICY, maxAgeFor } from "./sync.ts";

const POLICY = { macro: "1d", structure: "1h", setup: "15m", execution: "5m" } as const;
const feed = bullTargetFeed();
const today = feed[HISTORY_DAYS]!;
const open = dayOpen(HISTORY_DAYS);

describe("resampling (session-anchored, closed buckets only)", () => {
  it("aggregates OHLCV exactly", () => {
    const r = resampleSession(today, "15m", END);
    const first = r.session.candles[0]!;
    const base = today.candles.slice(0, 3);
    assert.equal(first.open, base[0]!.open);
    assert.equal(first.close, base[2]!.close);
    assert.equal(first.high, Math.max(...base.map((b) => b.high)));
    assert.equal(first.low, Math.min(...base.map((b) => b.low)));
    assert.equal(first.volume, 3000);
    assert.equal(r.session.candles.length, 28);
  });
  it("forming bucket is NOT available yet and NOT an error", () => {
    const r = resampleSession(today, "15m", open + 2 * M5); // 2 of 3 base bars closed
    assert.equal(r.session.candles.length, 0);
    assert.equal(r.forming, true);
    assert.equal(r.failure, undefined);
  });
  it("a closed bucket missing base bars => MISSING_CANDLES", () => {
    const holed = { ...today, candles: today.candles.filter((_, i) => i !== 1) };
    const r = resampleSession(holed, "15m", open + 3 * M5);
    assert.ok(r.failure?.blockers.includes("MISSING_CANDLES"));
  });
  it("trailing base bars missing inside a bucket that should be complete => MISSING_CANDLES", () => {
    const short = { ...today, candles: today.candles.slice(0, 2) };
    assert.ok(resampleSession(short, "15m", open + M15).failure?.blockers.includes("MISSING_CANDLES"));
  });
  it("1d bucket is the whole session and closes only at session close", () => {
    assert.equal(resampleSession(today, "1d", END - 1).session.candles.length, 0);
    const d = resampleSession(today, "1d", END);
    assert.equal(d.session.candles.length, 1);
    assert.equal(d.bucketEnds[0], today.closeTimestamp);
  });
  it("hourly buckets: 7 per 7h session", () => assert.equal(resampleSession(today, "1h", END).session.candles.length, 7));
});

describe("multi-timeframe synchronization", () => {
  it("higher timeframes may lag lower timeframes while remaining valid", () => {
    const now = open + 10 * M15 + M5; // mid-session, inside a forming hour
    const m = buildMultiTimeframeState({ sessions: feed.map((s) => ({ ...s, candles: s.candles.filter((c) => c.timestamp + M5 <= now) })), now, policy: POLICY });
    const role = (r: string) => m.roles.find((x) => x.role === r)!;
    assert.equal(m.synchronized, true);
    assert.ok(role("MACRO").lastClosedAt! < role("STRUCTURE").lastClosedAt!);
    assert.ok(role("STRUCTURE").lastClosedAt! < role("EXECUTION").lastClosedAt!);
    assert.equal(role("MACRO").lastClosedAt, dayOpen(HISTORY_DAYS - 1) + 7 * 60 * 60_000); // yesterday's close
  });
  it("stale required context blocks (role max age exceeded)", () => {
    const strict = { maxAgeByRole: { ...DEFAULT_TIMEFRAME_SYNC_POLICY.maxAgeByRole, MACRO: 60_000 } };
    const now = open + 10 * M15; // mid-session: macro's last closed candle is yesterday's
    const m = buildMultiTimeframeState({ sessions: asOfFeed(feed, now), now, policy: POLICY, syncPolicy: strict });
    assert.equal(m.synchronized, false);
    assert.ok(m.blockers.includes("STALE_DATA"));
  });
  it("max age is configurable per role with provisional defaults", () => {
    assert.equal(maxAgeFor("EXECUTION", DEFAULT_TIMEFRAME_SYNC_POLICY), 5 * 60_000 + 60_000);
    assert.equal(maxAgeFor("EXECUTION", { maxAgeByRole: { EXECUTION: 1 } }), 1);
  });
  it("symbol consistency across sessions", () => {
    const mixed = feed.map((s, i) => (i === 3 ? { ...s, symbol: "NVDA", candles: s.candles.map((c) => ({ ...c, symbol: "NVDA" })) } : s));
    const m = buildMultiTimeframeState({ sessions: mixed, now: END, policy: POLICY });
    assert.equal(m.synchronized, false);
    assert.ok(m.blockers.includes("MIXED_SERIES"));
  });
  it("session ordering (overlapping / out-of-order sessions)", () => {
    const swapped = [...feed];
    [swapped[2], swapped[3]] = [swapped[3]!, swapped[2]!];
    assert.equal(buildMultiTimeframeState({ sessions: swapped, now: END, policy: POLICY }).synchronized, false);
  });
  it("timeframe role mapping: base feed must match the policy's finest role", () => {
    const m = buildMultiTimeframeState({ sessions: feed, now: END, policy: { ...POLICY, refinement: "1m" } });
    assert.equal(m.synchronized, false);
    assert.ok(m.blockers.includes("MIXED_SERIES"));
  });
  it("timestamps need not be identical across timeframes — compatibility only", () => {
    const m = buildMultiTimeframeState({ sessions: feed, now: END, policy: POLICY });
    const ts = m.roles.map((r) => r.state!.timestamp);
    assert.equal(new Set(ts).size > 1, true);
    assert.ok(ts.every((t) => t < END));
  });
  it("candle-level corruption in history blocks synchronization", () => {
    const bad = feed.map((s, i) => (i === 5 ? { ...s, candles: s.candles.map((c, j) => (j === 4 ? { ...c, high: c.low - 1 } : c)) } : s));
    assert.equal(buildMultiTimeframeState({ sessions: bad, now: END, policy: POLICY }).synchronized, false);
  });
});
