import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import type { Candle } from "../domain/types.ts";
import { CALENDAR, END, M5 } from "../providers/provider-test-fixtures.ts";
import { auditBars, buildManifest, detectCorrections, verifyManifest } from "./dataset.ts";
import { canonicalJson, sha256Hex } from "./sha256.ts";

const bar = (ts: number, close = 100): Candle => ({ symbol: "SPX", timeframe: "5m", timestamp: ts, open: close, high: close + 1, low: close - 1, close, volume: 10 });
const day = CALENDAR.recentSessions(END, 1)[0]!;
const full = Array.from({ length: 84 }, (_, i) => bar(day.openTimestamp + i * M5));
const LICENSE = { terms: "test fixture", retentionDays: 30, redistribution: false as const };

describe("SHA-256 + canonical JSON", () => {
  it("matches node:crypto for ASCII, unicode and multi-block input", () => {
    for (const s of ["", "abc", "Klynge — 日本 ✓", "x".repeat(1000)]) assert.equal(sha256Hex(s), createHash("sha256").update(s, "utf8").digest("hex"));
  });
  it("canonical JSON is key-order independent", () => {
    assert.equal(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] }), canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }));
  });
});

describe("historical dataset audit", () => {
  it("complete session => no issues", () => assert.deepEqual(auditBars(full, CALENDAR, "5m", day.openTimestamp, day.closeTimestamp), []));
  it("detects missing bars, duplicates, out-of-order and off-session bars", () => {
    const bars = [...full];
    bars.splice(10, 1);
    bars.splice(20, 0, { ...bars[19]! });
    [bars[30], bars[31]] = [bars[31]!, bars[30]!];
    bars.push(bar(day.closeTimestamp + 60 * 60_000));
    const kinds = auditBars(bars, CALENDAR, "5m", day.openTimestamp, day.closeTimestamp).map((i) => i.kind);
    for (const k of ["MISSING_BARS", "DUPLICATE", "OUT_OF_ORDER", "OUTSIDE_SESSION"]) assert.ok(kinds.includes(k as never), k);
  });
  it("an entirely absent session is a session gap", () => {
    const prev = CALENDAR.recentSessions(END, 2)[0]!;
    const issues = auditBars(full, CALENDAR, "5m", prev.openTimestamp, day.closeTimestamp);
    assert.deepEqual(issues.map((i) => i.kind), ["MISSING_SESSION"]);
  });
  it("vendor corrections between acquisitions are recorded, never silently overwritten", () => {
    const revised = full.map((b, i) => (i === 5 ? { ...b, close: 101 } : b));
    const c = detectCorrections(full, revised);
    assert.equal(c.length, 1);
    assert.equal(c[0]!.kind, "CORRECTION");
  });
});

describe("dataset manifests", () => {
  const session = [{ sessionId: "SPX-1", symbol: "SPX", timeframe: "5m" as const, openTimestamp: day.openTimestamp, closeTimestamp: day.closeTimestamp, candles: full }];
  const raw = JSON.stringify({ results: full.map((b) => ({ t: b.timestamp, o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume })) });
  const m = buildManifest({ kind: "SYNTHETIC", provider: "mock", providerSymbol: "I:SPX", canonicalSymbol: "SPX", timeframe: "5m", from: day.openTimestamp, to: day.closeTimestamp, acquiredAt: END, rawText: raw, normalized: session, issues: [], license: LICENSE });
  it("content-addressed, versioned, labelled, reproducible", () => {
    assert.equal(m.kind, "SYNTHETIC");
    assert.equal(m.clean, true);
    assert.equal(m.bars, 84);
    assert.match(m.rawSha256, /^[0-9a-f]{64}$/);
    assert.equal(m.license.redistribution, false);
    const again = buildManifest({ kind: "SYNTHETIC", provider: "mock", providerSymbol: "I:SPX", canonicalSymbol: "SPX", timeframe: "5m", from: day.openTimestamp, to: day.closeTimestamp, acquiredAt: END, rawText: raw, normalized: session, issues: [], license: LICENSE });
    assert.deepEqual(again, m);
  });
  it("verification detects tampering with raw or normalized artifacts", () => {
    assert.deepEqual(verifyManifest(m, raw, session), { ok: true, problems: [] });
    assert.equal(verifyManifest(m, raw.replace("100", "999"), session).ok, false);
    const tampered = [{ ...session[0]!, candles: full.map((b, i) => (i === 0 ? { ...b, close: 1 } : b)) }];
    assert.deepEqual(verifyManifest(m, raw, tampered).problems, ["normalized data does not match the manifest hash"]);
  });
  it("blocking issues mark the dataset unclean", () => {
    const dirty = buildManifest({ kind: "HISTORICAL", provider: "p", providerSymbol: "x", canonicalSymbol: "SPX", timeframe: "5m", from: 0, to: 1, acquiredAt: 1, rawText: "", normalized: [], issues: [{ kind: "MISSING_BARS", at: 1, detail: "" }], license: LICENSE });
    assert.equal(dirty.clean, false);
  });
});
