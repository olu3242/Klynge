import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { aggregateBars, barsFromSessions, cmeEquityIndexCalendar, MockHistoricalProvider } from "./engine-core.ts";
import type { Candle, TradingSession } from "./engine-core.ts";
import { DatasetStore, ingestHistory } from "./history/pipeline.ts";
import { mockMarketData } from "./market-data.ts";
import { CmeFuturesProvider, MockFuturesBarsSource } from "./providers/cme-futures.ts";
import { FIXTURE_END, OHLCV_FIXTURE } from "./test-support.ts";

/** SYNTHETIC fixtures only — these exercise provenance/versioning mechanics and are never empirical evidence. */
const fixture = JSON.parse(readFileSync(OHLCV_FIXTURE, "utf8")) as { spx: TradingSession[] };
const setup = mockMarketData(OHLCV_FIXTURE);
const FROM = fixture.spx[0]!.openTimestamp;
const LICENSE = { terms: "synthetic fixture", retentionDays: null, redistribution: false as const };
const plan = { role: "SPX" as const, canonicalSymbol: "SPX", providerSymbol: "I:SPX" };
const tmp = () => new DatasetStore(mkdtempSync(path.join(tmpdir(), "klynge-dv-")));

describe("dataset versions (Batch 64)", () => {
  it("first acquisition is version 1; a vendor correction supersedes it as version 2; identical content is idempotent", async () => {
    const store = tmp();
    const go = (provider = setup.provider, at = FIXTURE_END) => ingestHistory({ provider, plan, timeframe: "5m", calendar: setup.calendar, from: FROM, to: FIXTURE_END, kind: "SYNTHETIC", license: LICENSE, acquiredAt: at, store });
    const v1 = await go();
    assert.deepEqual([v1.manifest.version, v1.manifest.supersedes, v1.manifest.adjustment], [1, null, "SPLIT_ADJUSTED"]);
    const corrected = fixture.spx.map((s, i) => (i === 2 ? { ...s, candles: s.candles.map((c, j) => (j === 4 ? { ...c, close: c.close + 0.25, high: Math.max(c.high, c.close + 0.25) } : c)) } : s));
    const v2 = await go(new MockHistoricalProvider("mock", { "I:SPX": barsFromSessions(corrected, "I:SPX") }), FIXTURE_END + 1);
    assert.deepEqual([v2.manifest.version, v2.manifest.supersedes], [2, v1.manifest.datasetId]);
    const again = await go(new MockHistoricalProvider("mock", { "I:SPX": barsFromSessions(corrected, "I:SPX") }), FIXTURE_END + 2);
    assert.equal(again.manifest.datasetId, v2.manifest.datasetId);
    assert.equal(store.manifests().length, 2, "v1 is preserved, never overwritten");
    assert.ok(store.verify(v1.manifest.datasetId).ok && store.verify(v2.manifest.datasetId).ok);
  });
});

describe("CME/MNQ historical ingestion (Batch 64)", () => {
  const cme = cmeEquityIndexCalendar();
  const open = Date.parse("2026-10-11T22:00:00Z");
  const N = 60;
  const minute: Candle[] = Array.from({ length: N }, (_, i) => ({ symbol: "MNQZ6", timeframe: "1m", timestamp: open + i * 60_000, open: 25_000 + i, high: 25_002 + i, low: 24_999 + i, close: 25_001 + i, volume: 2 + (i % 5) }));
  const provider = (bars = minute) => new CmeFuturesProvider({ source: new MockFuturesBarsSource({ MNQZ6: bars }), calendar: cme, roots: { "CME:MNQ": "MNQ" } });
  const ingest = (store: DatasetStore, tf: "5m" | "15m", bars = minute) =>
    ingestHistory({ provider: provider(bars), plan: { role: "MNQ", canonicalSymbol: "MNQ", providerSymbol: "CME:MNQ" }, timeframe: tf, calendar: cme, from: open, to: open + N * 60_000, kind: "SYNTHETIC", license: LICENSE, acquiredAt: open + N * 60_000, store });

  it("records the front contract and FRONT_CONTRACT adjustment in the manifest; no NQ substitution", async () => {
    const r = await ingest(tmp(), "5m");
    assert.equal(r.normalizedOk, true, r.failure);
    assert.equal(r.manifest.contract, "MNQZ6");
    assert.equal(r.manifest.adjustment, "FRONT_CONTRACT");
    assert.equal(r.manifest.providerSymbol, "CME:MNQ");
    assert.equal(r.manifest.bars, 12);
    assert.doesNotMatch(JSON.stringify(r.manifest), /\bNQ[HMUZ]\d/);
  });
  it("1m-derived 15m equals 1m-derived 5m re-aggregated to 15m (no lookahead, deterministic)", async () => {
    const store = tmp();
    const m15 = (await ingest(store, "15m")).manifest;
    const m5 = (await ingest(store, "5m")).manifest;
    const via5 = aggregateBars(store.normalized(m5.datasetId).flatMap((s) => s.candles), "15m", cme, open + N * 60_000);
    assert.deepEqual(store.normalized(m15.datasetId).flatMap((s) => s.candles).map((c) => [c.timestamp, c.open, c.high, c.low, c.close, c.volume]), via5.map((c) => [c.timestamp, c.open, c.high, c.low, c.close, c.volume]));
  });
  it("a missing 5m bucket is inventoried, never fabricated", async () => {
    const holed = minute.filter((_, i) => i < 10 || i >= 15);
    const r = await ingest(tmp(), "5m", holed);
    assert.equal(r.normalizedOk, false, "normalization fails closed on the gap");
    assert.equal(r.manifest.bars, 0, "no normalized bars are stored for a gapped range");
    assert.equal(r.manifest.clean, false);
    assert.ok(r.issues.some((i) => i.kind === "MISSING_BARS"));
  });
});
