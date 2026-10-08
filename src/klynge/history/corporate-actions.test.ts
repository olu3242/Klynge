import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Candle, TradingSession } from "../domain/types.ts";
import { buildManifest, detectCorporateActions } from "./dataset.ts";

const LICENSE = { terms: "synthetic", retentionDays: null, redistribution: false as const };
const day = (n: number, open: number, close: number): TradingSession => {
  const t = 1_790_000_000_000 + n * 86_400_000;
  const c = (ts: number, o: number, cl: number): Candle => ({ symbol: "TSLA", timeframe: "1d", timestamp: ts, open: o, high: Math.max(o, cl), low: Math.min(o, cl), close: cl, volume: 1 });
  return { sessionId: `TSLA-${n}`, symbol: "TSLA", timeframe: "1d", openTimestamp: t, closeTimestamp: t + 23_400_000, candles: [c(t, open, close)] };
};

describe("corporate-action detection (Batch 64)", () => {
  it("flags a >25% session gap (e.g. an unadjusted 3:1 split) without inventing an adjustment", () => {
    const issues = detectCorporateActions([day(0, 300, 300), day(1, 100, 101), day(2, 101, 102)]);
    assert.deepEqual(issues.map((i) => i.kind), ["CORPORATE_ACTION_SUSPECTED"]);
    assert.match(issues[0]!.detail, /-66\.7%/);
  });
  it("ordinary gaps are not flagged; the threshold is explicit", () => {
    assert.deepEqual(detectCorporateActions([day(0, 100, 100), day(1, 110, 111)]), []);
    assert.equal(detectCorporateActions([day(0, 100, 100), day(1, 110, 111)], 0.05).length, 1);
  });
  it("is a non-blocking issue recorded in the manifest with adjustment + version provenance", () => {
    const sessions = [day(0, 300, 300), day(1, 100, 101)];
    const issues = detectCorporateActions(sessions);
    const m = buildManifest({ kind: "HISTORICAL", provider: "p", providerSymbol: "TSLA", canonicalSymbol: "TSLA", timeframe: "1d", from: 0, to: 1, acquiredAt: 1, rawText: "{}", normalized: sessions, issues, license: LICENSE, adjustment: "UNADJUSTED", supersedes: null, version: 1 });
    assert.equal(m.clean, true, "a suspected corporate action needs review but does not invalidate bars");
    assert.equal(m.adjustment, "UNADJUSTED");
    assert.equal(m.version, 1);
    assert.equal(m.supersedes, null);
    assert.ok(Object.isFrozen(m));
  });
});
