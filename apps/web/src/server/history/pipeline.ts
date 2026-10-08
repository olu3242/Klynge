import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { auditBars, buildManifest, canonicalJson, detectCorporateActions, detectCorrections, normalizeFeed, verifyManifest } from "../engine-core.ts";
import type { Candle, DatasetIssue, DatasetKind, DatasetLicense, DatasetManifest, FeedPlan, MarketDataProvider, PriceAdjustment, SessionCalendar, Timeframe, TradingSession } from "../engine-core.ts";

/**
 * Reproducible historical ingestion. Layout (operator storage, never committed, never served to browsers):
 *   <root>/raw/<datasetId>.json         raw vendor payloads exactly as received (subject to license retention)
 *   <root>/normalized/<datasetId>.json  canonical TradingSessions (engine input)
 *   <root>/manifests/<datasetId>.json   provenance + SHA-256 of both + issues + license
 * Re-ingesting a range never overwrites: vendor corrections produce a new dataset with CORRECTION issues.
 */
export class DatasetStore {
  readonly root: string;
  constructor(root: string) {
    this.root = root;
    for (const d of ["raw", "normalized", "manifests"]) mkdirSync(path.join(root, d), { recursive: true });
  }
  private file = (kind: "raw" | "normalized" | "manifests", id: string) => path.join(this.root, kind, `${id.replace(/[^A-Za-z0-9._-]/g, "_")}.json`);
  put(m: DatasetManifest, rawText: string, normalized: readonly TradingSession[]): void {
    if (existsSync(this.file("manifests", m.datasetId))) return;
    writeFileSync(this.file("raw", m.datasetId), rawText);
    writeFileSync(this.file("normalized", m.datasetId), canonicalJson(normalized));
    writeFileSync(this.file("manifests", m.datasetId), JSON.stringify(m, null, 2));
  }
  manifests(): DatasetManifest[] {
    return readdirSync(path.join(this.root, "manifests"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(path.join(this.root, "manifests", f), "utf8")) as DatasetManifest)
      .sort((a, b) => a.acquiredAt - b.acquiredAt || a.datasetId.localeCompare(b.datasetId));
  }
  normalized(id: string): TradingSession[] {
    return JSON.parse(readFileSync(this.file("normalized", id), "utf8")) as TradingSession[];
  }
  raw(id: string): string | null {
    const f = this.file("raw", id);
    return existsSync(f) ? readFileSync(f, "utf8") : null;
  }
  /** Verify every stored artifact against its manifest (raw may be legitimately purged by retention). */
  verify(id: string): { ok: boolean; problems: string[] } {
    const m = this.manifests().find((x) => x.datasetId === id);
    if (!m) return { ok: false, problems: ["unknown dataset"] };
    const raw = this.raw(id);
    const v = verifyManifest(m, raw ?? "", this.normalized(id));
    return raw === null ? { ok: v.problems.every((p) => p.startsWith("raw")), problems: v.problems.filter((p) => !p.startsWith("raw")).concat("raw purged by retention policy") } : v;
  }
  /** Delete raw vendor records whose license retention has elapsed. Manifests + normalized hashes remain. */
  retentionSweep(now: number): string[] {
    const purged: string[] = [];
    for (const m of this.manifests()) {
      if (m.license.retentionDays === null) continue;
      if (now - m.acquiredAt > m.license.retentionDays * 86_400_000 && existsSync(this.file("raw", m.datasetId))) {
        rmSync(this.file("raw", m.datasetId));
        purged.push(m.datasetId);
      }
    }
    return purged;
  }
}

export interface IngestInput {
  provider: MarketDataProvider;
  plan: FeedPlan;
  timeframe: Timeframe;
  calendar: SessionCalendar;
  from: number;
  to: number;
  kind: DatasetKind;
  license: DatasetLicense;
  acquiredAt: number;
  store: DatasetStore;
  adjustment?: PriceAdjustment;
}

export interface IngestResult {
  manifest: DatasetManifest;
  issues: DatasetIssue[];
  corrections: DatasetIssue[];
  normalizedOk: boolean;
  failure?: string;
}

/** Fetch → keep raw → audit → normalize (fail-closed) → detect corrections vs prior acquisitions → manifest. */
export async function ingestHistory(i: IngestInput): Promise<IngestResult> {
  const res = await i.provider.getHistoricalCandles({ canonicalSymbol: i.plan.canonicalSymbol, providerSymbol: i.plan.providerSymbol, timeframe: i.timeframe, from: i.from, to: i.to });
  if (!res.ok) throw new Error(`ingest: ${res.failure.code} — ${res.failure.message}`);
  const rawText = JSON.stringify({ provider: i.provider.id, providerSymbol: i.plan.providerSymbol, request: { from: i.from, to: i.to, timeframe: i.timeframe }, payload: res.raw ?? { note: "adapter did not expose raw payloads", bars: res.value } });
  const audit = auditBars(res.value, i.calendar, i.timeframe, i.from, i.to);
  const norm = normalizeFeed({ provider: i.provider.id, plan: i.plan, timeframe: i.timeframe, results: [res], calendar: i.calendar, from: i.from, now: i.to, fetchedAt: i.acquiredAt });
  const sessions = norm.ok ? [...norm.sessions] : [];
  const prior = i.store
    .manifests()
    .filter((m) => m.provider === i.provider.id && m.canonicalSymbol === i.plan.canonicalSymbol && m.timeframe === i.timeframe && m.from === i.from && m.to === i.to)
    .at(-1);
  const corrections = prior ? detectCorrections(i.store.normalized(prior.datasetId).flatMap((s) => s.candles), sessions.flatMap((s): Candle[] => s.candles)) : [];
  const corporate = detectCorporateActions(sessions);
  const contract = res.warnings.find((w) => w.startsWith("front contract "))?.split(" ")[2];
  const issues = [...audit, ...corrections, ...corporate, ...(norm.ok ? [] : [{ kind: "STALE" as const, at: i.to, detail: `normalization failed: ${norm.failure.code}` }])].filter((x, idx, arr) => arr.findIndex((y) => y.kind === x.kind && y.at === x.at) === idx);
  const base = { kind: i.kind, provider: i.provider.id, providerSymbol: i.plan.providerSymbol, canonicalSymbol: i.plan.canonicalSymbol, timeframe: i.timeframe, from: i.from, to: i.to, acquiredAt: i.acquiredAt, rawText, normalized: sessions, issues, license: i.license, adjustment: i.adjustment ?? (contract ? ("FRONT_CONTRACT" as const) : ("SPLIT_ADJUSTED" as const)), ...(contract ? { contract } : {}) };
  // Version chain: identical content keeps the prior id; different content supersedes it (never overwritten).
  const probe = buildManifest(base);
  const manifest = prior && probe.normalizedSha256 !== prior.normalizedSha256 ? buildManifest({ ...base, supersedes: prior.datasetId, version: (prior.version ?? 1) + 1 }) : prior && probe.normalizedSha256 === prior.normalizedSha256 ? prior : buildManifest({ ...base, supersedes: null, version: 1 });
  i.store.put(manifest, rawText, sessions);
  return { manifest, issues, corrections, normalizedOk: norm.ok, ...(norm.ok ? {} : { failure: norm.failure.message }) };
}
