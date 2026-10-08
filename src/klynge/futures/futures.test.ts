import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cmeEquityIndexCalendar, nyseCalendar } from "../calendar/exchange-calendars.ts";
import type { Candle } from "../domain/types.ts";
import { resampleSession } from "../timeframe/resample.ts";
import { aggregateBars } from "./aggregate.ts";
import { activeContract, contractFor, parseContractSymbol } from "./contracts.ts";

const iso = (t: number) => new Date(t).toISOString();
const M = 60_000;

describe("CME quarterly contracts + roll rule", () => {
  it("MNQZ6 expires the 3rd Friday of Dec 2026 at 09:30 ET; default roll 8 days earlier", () => {
    const z6 = contractFor("MNQ", 2026, 12);
    assert.equal(z6.symbol, "MNQZ6");
    assert.equal(iso(z6.expiry), "2026-12-18T14:30:00.000Z");
    assert.equal(iso(z6.rollAt), "2026-12-10T14:30:00.000Z");
    assert.equal(iso(contractFor("MNQ", 2026, 9).expiry), "2026-09-18T13:30:00.000Z", "EDT in September");
  });
  it("front contract selection across rolls and year end", () => {
    assert.equal(activeContract("MNQ", Date.parse("2026-10-08T15:00:00Z")).symbol, "MNQZ6");
    assert.equal(activeContract("MNQ", Date.parse("2026-12-10T14:29:00Z")).symbol, "MNQZ6");
    assert.equal(activeContract("MNQ", Date.parse("2026-12-10T14:31:00Z")).symbol, "MNQH7");
    assert.equal(activeContract("MNQ", Date.parse("2026-09-11T15:00:00Z")).symbol, "MNQZ6");
    assert.equal(activeContract("MNQ", Date.parse("2026-12-31T15:00:00Z")).symbol, "MNQH7");
    assert.equal(activeContract("MNQ", Date.parse("2026-10-08T15:00:00Z"), { rollDaysBeforeExpiry: 0 }).symbol, "MNQZ6");
  });
  it("rejects non-quarterly months, bad roots and out-of-range roll rules; parses symbols", () => {
    assert.throws(() => contractFor("MNQ", 2026, 11), /quarterly/);
    assert.throws(() => contractFor("mnq", 2026, 12), /invalid root/);
    assert.throws(() => contractFor("MNQ", 2026, 12, { rollDaysBeforeExpiry: 90 }), /roll rule/);
    assert.deepEqual(parseContractSymbol("MNQZ6", Date.parse("2026-10-08T00:00:00Z")), { root: "MNQ", year: 2026, month: 12 });
    assert.deepEqual(parseContractSymbol("MNQH0", Date.parse("2029-12-20T00:00:00Z")), { root: "MNQ", year: 2030, month: 3 });
    assert.equal(parseContractSymbol("MNQX6", 0), null);
  });
});

describe("bar aggregation (never fills gaps)", () => {
  const cme = cmeEquityIndexCalendar();
  const open = Date.parse("2026-10-11T22:00:00Z"); // Sun 18:00 EDT → Monday's CME session
  const m1 = (i: number, px = 100): Candle => ({ symbol: "CME:MNQ", timeframe: "1m", timestamp: open + i * M, open: px, high: px + 1, low: px - 1, close: px + 0.5, volume: 2 });
  it("1m → 5m aligned to the session open; OHLCV combined; order-independent", () => {
    const bars = [m1(4, 104), m1(0, 100), m1(1, 101), m1(2, 102), m1(3, 103)];
    const [b] = aggregateBars(bars, "5m", cme, open + 10 * M);
    assert.deepEqual(b, { symbol: "CME:MNQ", timeframe: "5m", timestamp: open, open: 100, high: 105, low: 99, close: 104.5, volume: 10 });
  });
  it("minutes without trades are tolerated; a bucket with no bars stays absent; forming buckets are excluded", () => {
    const bars = [m1(0), m1(3), m1(10), m1(11)];
    const out = aggregateBars(bars, "5m", cme, open + 14 * M);
    assert.deepEqual(out.map((b) => (b.timestamp - open) / M), [0], "5–10 empty (absent), 10–15 still forming");
    assert.deepEqual(aggregateBars(bars, "5m", cme, open + 15 * M).map((b) => (b.timestamp - open) / M), [0, 10]);
  });
  it("bars outside regular sessions are dropped (calendar decides)", () => {
    const halt = Date.parse("2026-10-12T21:30:00Z"); // 17:30 EDT maintenance halt
    assert.deepEqual(aggregateBars([{ ...m1(0), timestamp: halt }], "5m", cme, halt + 3_600_000), []);
  });
  it("consistent with the engine's MTF resampler: 1m→15m equals 1m→5m→15m", () => {
    const nyse = nyseCalendar();
    const s = Date.parse("2026-10-07T13:30:00Z");
    const minute: Candle[] = Array.from({ length: 60 }, (_, i) => ({ symbol: "SPX", timeframe: "1m", timestamp: s + i * M, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 0 }));
    const now = s + 60 * M;
    const direct = aggregateBars(minute, "15m", nyse, now);
    const five = aggregateBars(minute, "5m", nyse, now);
    const w = nyse.sessionAt(s)!;
    const viaEngine = resampleSession({ sessionId: "x", symbol: "SPX", timeframe: "5m", openTimestamp: w.openTimestamp, closeTimestamp: w.closeTimestamp, candles: five }, "15m", now).session.candles;
    assert.deepEqual(viaEngine.map((c) => [c.timestamp, c.open, c.high, c.low, c.close, c.volume]), direct.map((c) => [c.timestamp, c.open, c.high, c.low, c.close, c.volume]));
  });
});
