import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeFeed } from "../providers/normalize.ts";
import type { Candle } from "../domain/types.ts";
import { dstBoundsUtc, easternDateOf, easternOffsetMs, easternToUtc, nthWeekday } from "./eastern-time.ts";
import { cmeEquityIndexCalendar, nyseCalendar } from "./exchange-calendars.ts";

const H = 3_600_000;
const iso = (t: number) => new Date(t).toISOString();
const nyse = nyseCalendar();
const cme = cmeEquityIndexCalendar();

describe("US Eastern time (explicit DST rule)", () => {
  it("DST 2026: starts Sun Mar 8 07:00Z, ends Sun Nov 1 06:00Z", () => {
    assert.equal(nthWeekday(2026, 3, 0, 2), 8);
    const { start, end } = dstBoundsUtc(2026);
    assert.equal(iso(start), "2026-03-08T07:00:00.000Z");
    assert.equal(iso(end), "2026-11-01T06:00:00.000Z");
    assert.equal(easternOffsetMs(start - 1), -5 * H);
    assert.equal(easternOffsetMs(start), -4 * H);
    assert.equal(easternOffsetMs(end - 1), -4 * H);
    assert.equal(easternOffsetMs(end), -5 * H);
  });
  it("wall-clock conversion both ways", () => {
    assert.equal(iso(easternToUtc({ year: 2026, month: 1, day: 5 }, 9, 30)), "2026-01-05T14:30:00.000Z");
    assert.equal(iso(easternToUtc({ year: 2026, month: 7, day: 6 }, 9, 30)), "2026-07-06T13:30:00.000Z");
    assert.deepEqual(easternDateOf(Date.parse("2026-07-07T03:30:00Z")), { year: 2026, month: 7, day: 6, weekday: 1, minutes: 23 * 60 + 30 });
  });
});

describe("NYSE calendar", () => {
  it("regular session shifts with DST (Fri Mar 6 vs Mon Mar 9 2026)", () => {
    assert.equal(iso(nyse.sessionAt(Date.parse("2026-03-06T15:00:00Z"))!.openTimestamp), "2026-03-06T14:30:00.000Z");
    assert.equal(iso(nyse.sessionAt(Date.parse("2026-03-09T15:00:00Z"))!.openTimestamp), "2026-03-09T13:30:00.000Z");
    assert.equal(iso(nyse.sessionAt(Date.parse("2026-03-09T15:00:00Z"))!.closeTimestamp), "2026-03-09T20:00:00.000Z");
  });
  it("weekends, holidays and early closes", () => {
    assert.equal(nyse.status(Date.parse("2026-10-10T15:00:00Z")), "CLOSED", "Saturday");
    assert.equal(nyse.status(Date.parse("2026-11-26T15:00:00Z")), "EXCLUDED", "Thanksgiving");
    assert.equal(nyse.excluded(Date.parse("2026-11-26T15:00:00Z")), "exchange holiday");
    const blackFriday = nyse.sessionAt(Date.parse("2026-11-27T15:00:00Z"))!;
    assert.equal(iso(blackFriday.closeTimestamp), "2026-11-27T18:00:00.000Z", "13:00 ET early close");
    assert.equal(nyse.status(Date.parse("2026-11-27T18:30:00Z")), "CLOSED");
    assert.equal(nyse.status(Date.parse("2026-07-03T15:00:00Z")), "EXCLUDED", "Independence Day observed");
  });
  it("sessions across a holiday weekend skip the closure (no fabricated session)", () => {
    const s = nyse.sessionsBetween(Date.parse("2026-11-25T00:00:00Z"), Date.parse("2026-12-01T00:00:00Z")).map((w) => iso(w.openTimestamp).slice(0, 10));
    assert.deepEqual(s, ["2026-11-25", "2026-11-27", "2026-11-30"]);
    const recent = nyse.recentSessions(Date.parse("2026-11-30T15:00:00Z"), 3).map((w) => iso(w.openTimestamp).slice(0, 10));
    assert.deepEqual(recent, ["2026-11-25", "2026-11-27", "2026-11-30"]);
  });
  it("fails closed outside the verified coverage", () => {
    assert.equal(nyse.status(Date.parse("2028-03-01T15:00:00Z")), "OUTSIDE_COVERAGE");
    assert.equal(nyse.sessionAt(Date.parse("2028-03-01T15:00:00Z")), null);
    assert.equal(nyse.covers(Date.parse("2024-12-31T15:00:00Z")), false);
  });
});

describe("CME Globex equity-index calendar (MNQ)", () => {
  it("overnight session: Sunday 18:00 ET → Monday 17:00 ET, then the maintenance halt", () => {
    const sundayNight = Date.parse("2026-10-11T23:30:00Z"); // Sun 19:30 EDT
    const w = cme.sessionAt(sundayNight)!;
    assert.equal(iso(w.openTimestamp), "2026-10-11T22:00:00.000Z");
    assert.equal(iso(w.closeTimestamp), "2026-10-12T21:00:00.000Z");
    assert.equal(cme.status(Date.parse("2026-10-12T21:30:00Z")), "CLOSED", "17:00–18:00 ET halt");
    assert.equal(cme.status(Date.parse("2026-10-12T22:30:00Z")), "OPEN", "Tuesday's session opened Monday 18:00");
    assert.equal(cme.status(Date.parse("2026-10-10T15:00:00Z")), "CLOSED", "Saturday");
  });
  it("DST transition weekend: Monday session opens Sunday 18:00 local in the new offset", () => {
    const w = cme.sessionAt(Date.parse("2026-03-09T03:00:00Z"))!;
    assert.equal(iso(w.openTimestamp), "2026-03-08T22:00:00.000Z", "Sun Mar 8 18:00 EDT");
    const fall = cme.sessionAt(Date.parse("2026-11-02T03:00:00Z"))!;
    assert.equal(iso(fall.openTimestamp), "2026-11-01T23:00:00.000Z", "Sun Nov 1 18:00 EST");
  });
  it("holiday trading days are excluded (special CME hours are not guessed)", () => {
    assert.equal(cme.status(Date.parse("2026-01-19T15:00:00Z")), "EXCLUDED", "MLK day");
    assert.match(cme.excluded(Date.parse("2026-01-19T15:00:00Z")) ?? "", /not modelled/);
  });
});

describe("calendar ↔ normalization (fail closed)", () => {
  const bar = (ts: number): Candle => ({ symbol: "SPX", timeframe: "5m", timestamp: ts, open: 1, high: 1, low: 1, close: 1, volume: 1 });
  const plan = { role: "SPX" as const, canonicalSymbol: "SPX", providerSymbol: "SPX" };
  const run = (bars: Candle[], from: number, now: number) =>
    normalizeFeed({ provider: "t", plan, timeframe: "5m", results: [{ ok: true, value: bars, providerSymbol: "SPX", fetchedAt: now, warnings: [] }], calendar: nyse, from, now, fetchedAt: now });
  it("a bar during a holiday is dropped with a warning; an off-hours bar fails", () => {
    const open = Date.parse("2026-11-27T14:30:00Z");
    const holidayBar = Date.parse("2026-11-26T15:00:00Z");
    const good = Array.from({ length: 6 }, (_, i) => bar(open + i * 300_000));
    const r = run([bar(holidayBar), ...good], Date.parse("2026-11-26T14:30:00Z"), open + 30 * 60_000);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(r.ok && r.provenance.warnings.some((w) => w.includes("excluded session")));
    const night = run([bar(Date.parse("2026-11-27T02:00:00Z"))], Date.parse("2026-11-26T14:30:00Z"), open + 30 * 60_000);
    assert.equal(!night.ok && night.failure.code, "SESSION_BOUNDARY");
  });
  it("windows outside coverage fail closed", () => {
    const r = run([], Date.parse("2028-01-03T14:30:00Z"), Date.parse("2028-01-03T16:00:00Z"));
    assert.equal(!r.ok && r.failure.code, "SESSION_BOUNDARY");
  });
});
