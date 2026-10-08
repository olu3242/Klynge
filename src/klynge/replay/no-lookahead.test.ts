import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { discoverLevels } from "../levels/discover-levels.ts";
import { M15 } from "../mtf-test-fixtures.ts";
import { resampleSession } from "../timeframe/resample.ts";
import { assertAsOf, assertFrameAsOf, feedAsOf, LookaheadViolation } from "./as-of.ts";
import { chainAsOf, replayFrameAt, replaySession } from "./replay-engine.ts";
import { chainAt, END, M5, perturbFuture, replayInput } from "./replay-test-fixtures.ts";

const input = replayInput();
const full = replaySession(input);
const frameAt = (k: number) => full.frames[k]!;

describe("as-of guard", () => {
  it("assertAsOf rejects any source after T", () => {
    const T = frameAt(10).timestamp; // e.g. 10:00
    assert.doesNotThrow(() => assertAsOf(T, [T, T - 1]));
    assert.throws(() => assertAsOf(T, [T + M5]), LookaheadViolation); // the 10:05 candle close
  });
  it("feedAsOf keeps only candles CLOSED at or before T", () => {
    const T = frameAt(10).timestamp;
    const cut = feedAsOf(input.target, T);
    assert.ok(cut.flatMap((s) => s.candles).every((c) => c.timestamp + M5 <= T));
    assert.equal(cut.at(-1)!.candles.length, 11);
  });
  it("every replayed frame passes the frame-level as-of assertion", () => {
    for (const f of full.frames) assert.doesNotThrow(() => assertFrameAsOf(f));
  });
});

describe("no future candles", () => {
  it("frame at T cannot use the candle that closes at T + 5m (perturbing it changes nothing)", () => {
    const k = 30;
    const T = frameAt(k).timestamp;
    const perturbed = { ...input, target: perturbFuture(input.target, T), spx: perturbFuture(input.spx, T), mnq: perturbFuture(input.mnq, T) };
    assert.deepEqual(replayFrameAt(perturbed, T, frameAt(k - 1).setupDecision), frameAt(k));
  });
  it("future invariance: replaying truncated history reproduces every earlier frame byte-for-byte", () => {
    const k = 60;
    const T = frameAt(k).timestamp;
    const truncated = { ...input, target: feedAsOf(input.target, T), spx: feedAsOf(input.spx, T), mnq: feedAsOf(input.mnq, T) };
    const partial = replaySession(truncated);
    assert.equal(partial.frames.length, k + 1);
    assert.equal(JSON.stringify(partial.frames), JSON.stringify(full.frames.slice(0, k + 1)));
  });
});

describe("no future structure, levels or regime", () => {
  it("a swing confirmed later does not exist in an earlier frame", () => {
    const firstRes = full.frames.findIndex((f) => f.setupDecision?.level?.type === "RESISTANCE");
    assert.ok(firstRes > 0);
    const level = full.frames[firstRes]!.setupDecision!.level!;
    // The cluster qualifies when its 2nd swing is confirmed; that confirming 15m candle closes at confirmedAt + 15m.
    assert.ok(full.frames[firstRes]!.timestamp >= level.confirmedAt! + M15);
    assert.notEqual(full.frames[firstRes - 1]!.setupDecision?.level?.type, "RESISTANCE");
    for (const f of full.frames.slice(0, firstRes)) assert.ok(f.timestamp < level.confirmedAt! + M15);
  });
  it("future session highs/lows and S/R touches cannot leak into earlier levels", () => {
    const today = resampleSession(input.target.at(-1)!, "15m", END).session;
    const k = 12;
    const asOf = discoverLevels({ session: today, asOfIndex: k });
    const perturbed = { ...today, candles: today.candles.map((c, i) => (i > k ? { ...c, high: c.high + 50, low: c.low - 50 } : c)) };
    assert.deepEqual(discoverLevels({ session: perturbed, asOfIndex: k }), asOf);
    const cut = today.candles[k]!.timestamp;
    for (const l of asOf) {
      assert.ok(l.createdAt <= cut);
      if (l.lastTestedAt !== undefined) assert.ok(l.lastTestedAt <= cut);
    }
  });
  it("a future market-regime change does not alter earlier market truth", () => {
    const k = 40;
    const T = frameAt(k).timestamp;
    const crash = { ...input, spx: perturbFuture(input.spx, T, 0.5), mnq: perturbFuture(input.mnq, T, 0.5) };
    const f = replayFrameAt(crash, T, frameAt(k - 1).setupDecision);
    assert.deepEqual(f.marketTruth, frameAt(k).marketTruth);
  });
});

describe("no future options data", () => {
  it("a frame only sees the latest chain snapshot taken at or before it", () => {
    const early = chainAt(frameAt(5).timestamp);
    const late = chainAt(END - 1_000);
    assert.equal(chainAsOf([late, early], "TSLA", frameAt(6).timestamp), early);
    assert.equal(chainAsOf([late], "TSLA", frameAt(6).timestamp), undefined);
  });
  it("frames before a snapshot exists carry no options decision; later frames cite a past snapshot", () => {
    const withEarly = replayInput("BULLISH", [chainAt(frameAt(5).timestamp), chainAt(END - 1_000)]);
    const k = 6;
    const f = replayFrameAt(withEarly, frameAt(k).timestamp, frameAt(k - 1).setupDecision);
    assert.ok(f.optionsDecision);
    assert.ok(f.optionsDecision.chainTimestamp <= f.timestamp);
    assert.equal(replayFrameAt(withEarly, frameAt(4).timestamp, frameAt(3).setupDecision).optionsDecision, undefined);
  });
  it("quotes stamped after T are rejected, never used", () => {
    const T = END;
    const futureQuote = replayInput("BULLISH", [{ ...chainAt(T - 1_000), contracts: [chainAt(T + 60_000).contracts[0]!] }]);
    const f = replayFrameAt(futureQuote, T, full.frames.at(-2)!.setupDecision);
    assert.equal(f.optionsDecision?.eligibleContracts.length, 0);
    assert.ok(f.optionsDecision?.candidates[0]?.blockers.includes("FUTURE_QUOTE"));
  });
});
