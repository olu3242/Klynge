import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { barsFromSessions, MockHistoricalProvider, replaySession } from "./engine-core.ts";
import type { TradingSession } from "./engine-core.ts";
import { DatasetStore, ingestHistory } from "./history/pipeline.ts";
import { mockMarketData } from "./market-data.ts";
import { FIXTURE_END, OHLCV_FIXTURE } from "./test-support.ts";

const fixture = JSON.parse(readFileSync(OHLCV_FIXTURE, "utf8")) as { target: TradingSession[]; spx: TradingSession[]; mnq: TradingSession[]; timeframePolicy: never };
const setup = mockMarketData(OHLCV_FIXTURE);
const FROM = fixture.spx[0]!.openTimestamp;
const LICENSE = { terms: "synthetic fixture", retentionDays: 30, redistribution: false as const };
const plan = { role: "SPX" as const, canonicalSymbol: "SPX", providerSymbol: "I:SPX" };
const ingest = (store: DatasetStore, provider = setup.provider, acquiredAt = FIXTURE_END) =>
  ingestHistory({ provider, plan, timeframe: "5m", calendar: setup.calendar, from: FROM, to: FIXTURE_END, kind: "SYNTHETIC", license: LICENSE, acquiredAt, store });

describe("historical ingestion pipeline", () => {
  it("raw vendor records, normalized inputs and a hashed manifest are stored separately", async () => {
    const store = new DatasetStore(mkdtempSync(path.join(tmpdir(), "klynge-ds-")));
    const r = await ingest(store);
    assert.equal(r.normalizedOk, true);
    assert.equal(r.manifest.clean, true);
    assert.equal(r.manifest.kind, "SYNTHETIC");
    assert.equal(r.manifest.sessions, fixture.spx.length);
    assert.deepEqual(store.verify(r.manifest.datasetId), { ok: true, problems: [] });
    const raw = JSON.parse(store.raw(r.manifest.datasetId)!);
    assert.equal(raw.providerSymbol, "I:SPX", "raw keeps vendor symbols");
    assert.ok(store.normalized(r.manifest.datasetId).every((s) => s.symbol === "SPX"), "normalized uses canonical symbols");
  });
  it("re-ingesting never overwrites; vendor corrections create a new dataset with CORRECTION issues", async () => {
    const store = new DatasetStore(mkdtempSync(path.join(tmpdir(), "klynge-ds-")));
    const first = await ingest(store);
    const same = await ingest(store);
    assert.equal(same.manifest.datasetId, first.manifest.datasetId, "identical content => identical dataset id");
    const corrected = fixture.spx.map((s, i) => (i === 3 ? { ...s, candles: s.candles.map((c, j) => (j === 10 ? { ...c, close: c.close + 0.5, high: Math.max(c.high, c.close + 0.5) } : c)) } : s));
    const revised = new MockHistoricalProvider("mock", { "I:SPX": barsFromSessions(corrected, "I:SPX") });
    const r = await ingest(store, revised, FIXTURE_END + 1);
    assert.notEqual(r.manifest.datasetId, first.manifest.datasetId);
    assert.deepEqual(r.corrections.map((c) => c.kind), ["CORRECTION"]);
    assert.equal(store.manifests().length, 2);
  });
  it("gaps in vendor data are inventoried and the dataset is marked unclean (never filled)", async () => {
    const store = new DatasetStore(mkdtempSync(path.join(tmpdir(), "klynge-ds-")));
    const holed = fixture.spx.map((s, i) => (i === 5 ? { ...s, candles: s.candles.filter((_, j) => j !== 20) } : s));
    const r = await ingest(store, new MockHistoricalProvider("mock", { "I:SPX": barsFromSessions(holed, "I:SPX") }));
    assert.equal(r.manifest.clean, false);
    assert.ok(r.issues.some((i) => i.kind === "MISSING_BARS"));
    assert.equal(r.normalizedOk, false, "normalization fails closed on the gap");
  });
  it("tampering is detected; retention purges raw records but keeps manifests + normalized hashes", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "klynge-ds-"));
    const store = new DatasetStore(dir);
    const r = await ingest(store);
    const nf = path.join(dir, "normalized", `${r.manifest.datasetId.replace(/[^A-Za-z0-9._-]/g, "_")}.json`);
    const original = readFileSync(nf, "utf8");
    writeFileSync(nf, original.replace(/"close":\d+(\.\d+)?/, '"close":1'));
    assert.equal(store.verify(r.manifest.datasetId).ok, false);
    writeFileSync(nf, original);
    assert.deepEqual(store.retentionSweep(FIXTURE_END + 29 * 86_400_000), []);
    assert.deepEqual(store.retentionSweep(FIXTURE_END + 31 * 86_400_000), [r.manifest.datasetId]);
    assert.equal(store.raw(r.manifest.datasetId), null);
    const v = store.verify(r.manifest.datasetId);
    assert.equal(v.ok, true);
    assert.deepEqual(v.problems, ["raw purged by retention policy"]);
  });
  it("historical replay is deterministic and identical from stored normalized data", async () => {
    const store = new DatasetStore(mkdtempSync(path.join(tmpdir(), "klynge-ds-")));
    const ids: Record<string, string> = {};
    for (const [role, canonical, providerSymbol] of [["TARGET", "TSLA", "TSLA"], ["SPX", "SPX", "I:SPX"], ["MNQ", "MNQ", "MNQ1!"]] as const) {
      const r = await ingestHistory({ provider: setup.provider, plan: { role, canonicalSymbol: canonical, providerSymbol }, timeframe: "5m", calendar: setup.calendar, from: FROM, to: FIXTURE_END, kind: "SYNTHETIC", license: LICENSE, acquiredAt: FIXTURE_END, store });
      ids[role] = r.manifest.datasetId;
    }
    const fromStore = { target: store.normalized(ids.TARGET!), spx: store.normalized(ids.SPX!), mnq: store.normalized(ids.MNQ!), timeframePolicy: fixture.timeframePolicy };
    const a = replaySession(fromStore);
    const b = replaySession(fromStore);
    assert.deepEqual(a, b);
    assert.equal(a.frames.at(-1)?.setupDecision?.decision, replaySession({ target: fixture.target, spx: fixture.spx, mnq: fixture.mnq, timeframePolicy: fixture.timeframePolicy }).frames.at(-1)?.setupDecision?.decision);
  });
});
