import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { replayFrameAt, replaySession } from "./replay-engine.ts";
import { END, M5, replayInput } from "./replay-test-fixtures.ts";

const input = replayInput();
const result = replaySession(input);
const frames = result.frames;

describe("historical replay engine", () => {
  it("one frame per closed base candle of the replayed session, strictly increasing", () => {
    assert.equal(frames.length, 84);
    for (let i = 1; i < frames.length; i++) assert.equal(frames[i]!.timestamp - frames[i - 1]!.timestamp, M5);
    assert.equal(frames.at(-1)!.timestamp, END);
  });
  it("frames carry market truth, multi-timeframe state and setup decision at the frame clock", () => {
    for (const f of frames) {
      assert.equal(f.marketTruth.provenance.evaluatedAt, f.timestamp);
      assert.equal(f.multiTimeframe?.timestamp, f.timestamp);
      assert.equal(f.setupDecision?.provenance.evaluatedAt, f.timestamp);
    }
  });
  it("reaches CALL_SETUP at the end of the bullish session; options evaluated only from a past chain", () => {
    const last = frames.at(-1)!;
    assert.equal(last.setupDecision?.decision, "CALL_SETUP");
    assert.equal(last.optionsDecision?.decision, "ELIGIBLE");
    assert.ok(frames.slice(0, -1).every((f) => f.optionsDecision === undefined)); // chain only exists from END − 1s
  });
  it("lifecycle identity is carried across frames (previous decision chaining)", () => {
    const ids = frames.map((f) => f.setupDecision?.setup?.setupId).filter(Boolean);
    assert.ok(ids.length >= 2);
    assert.equal(new Set(ids.slice(-2)).size, 1);
  });
  it("a single frame recomputed at T equals the replayed frame at T", () => {
    for (const k of [10, 40, 83]) assert.deepEqual(replayFrameAt(input, frames[k]!.timestamp, frames[k - 1]?.setupDecision), frames[k]);
  });
  it("is deterministic over repeated runs", () => assert.equal(JSON.stringify(replaySession(replayInput())), JSON.stringify(result)));
  it("frames are immutable", () => {
    assert.ok(Object.isFrozen(frames[0]) && Object.isFrozen(frames[0]!.setupDecision));
    assert.throws(() => {
      (frames[0] as { timestamp: number }).timestamp = 0;
    }, TypeError);
  });
  it("bearish replay mirrors to PUT_SETUP", () => assert.equal(replaySession(replayInput("BEARISH", [])).frames.at(-1)?.setupDecision?.decision, "PUT_SETUP"));
  it("rejects a non-monotonic clock", () => {
    const bad = replayInput();
    const cur = bad.target.at(-1)!;
    const swapped = [...cur.candles];
    [swapped[3], swapped[4]] = [swapped[4]!, swapped[3]!];
    assert.throws(() => replaySession({ ...bad, target: [...bad.target.slice(0, -1), { ...cur, candles: swapped }] }), RangeError);
  });
});
