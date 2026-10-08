import { deepFreeze } from "../domain/freeze.ts";
import type { Candle, Timeframe, TradingSession } from "../domain/types.ts";
import { KLYNGE_ENGINE_VERSION, KLYNGE_RULE_VERSION } from "../engine/version.ts";
import type { SessionCalendar } from "../providers/calendar.ts";
import { TIMEFRAME_MS } from "../timeframe/timeframe.ts";
import { canonicalJson, sha256Hex } from "./sha256.ts";

/**
 * Historical datasets. Raw vendor records and normalized engine inputs are kept separately and both are
 * content-hashed in a manifest. SYNTHETIC datasets are labelled as such everywhere and can never support
 * empirical claims.
 */
export type DatasetKind = "HISTORICAL" | "SYNTHETIC";

export type DatasetIssueKind = "MISSING_BARS" | "MISSING_SESSION" | "DUPLICATE" | "OUT_OF_ORDER" | "OUTSIDE_SESSION" | "CORRECTION" | "STALE";

export interface DatasetIssue {
  kind: DatasetIssueKind;
  at: number;
  detail: string;
}

export interface DatasetLicense {
  /** Free-text license reference (vendor terms the operator accepted). */
  terms: string;
  /** Raw records must be deleted after this many days (null = per-terms indefinite). */
  retentionDays: number | null;
  /** Raw vendor data is never redistributed (UI, notifications, exports). */
  redistribution: false;
}

export interface DatasetManifest {
  datasetId: string;
  kind: DatasetKind;
  provider: string;
  providerSymbol: string;
  canonicalSymbol: string;
  timeframe: Timeframe;
  from: number;
  to: number;
  acquiredAt: number;
  rawSha256: string;
  normalizedSha256: string;
  bars: number;
  sessions: number;
  issues: DatasetIssue[];
  /** Clean = no issue that would make the engine fail closed. */
  clean: boolean;
  license: DatasetLicense;
  engineVersion: string;
  ruleVersion: string;
}

/**
 * Inventory (not a gate): every gap, duplicate, ordering fault and off-session bar in a raw series relative to the
 * exchange calendar. Normalization separately fails closed on the same conditions.
 */
export function auditBars(bars: readonly Candle[], calendar: SessionCalendar, timeframe: Timeframe, from: number, to: number): DatasetIssue[] {
  const tf = TIMEFRAME_MS[timeframe];
  const issues: DatasetIssue[] = [];
  const seen = new Set<number>();
  for (const [i, b] of bars.entries()) {
    const prev = bars[i - 1];
    if (seen.has(b.timestamp)) issues.push({ kind: "DUPLICATE", at: b.timestamp, detail: "duplicate bar timestamp" });
    else if (prev && b.timestamp < prev.timestamp) issues.push({ kind: "OUT_OF_ORDER", at: b.timestamp, detail: `after ${prev.timestamp}` });
    seen.add(b.timestamp);
    if (!calendar.sessionAt(b.timestamp) && !calendar.excluded?.(b.timestamp)) issues.push({ kind: "OUTSIDE_SESSION", at: b.timestamp, detail: "bar outside any regular session" });
  }
  for (const w of calendar.sessionsBetween(from, to)) {
    const expected: number[] = [];
    for (let t = Math.max(w.openTimestamp, from); t < w.closeTimestamp && t + tf <= to; t += tf) expected.push(t);
    const missing = expected.filter((t) => !seen.has(t));
    if (expected.length > 0 && missing.length === expected.length) issues.push({ kind: "MISSING_SESSION", at: w.openTimestamp, detail: "no bars for an entire regular session" });
    else for (const t of missing) issues.push({ kind: "MISSING_BARS", at: t, detail: "expected bar absent" });
  }
  return issues.sort((a, b) => a.at - b.at || a.kind.localeCompare(b.kind));
}

/** Bars whose OHLCV changed between two acquisitions of the same range (vendor corrections). */
export function detectCorrections(previous: readonly Candle[], next: readonly Candle[]): DatasetIssue[] {
  const byTs = new Map(previous.map((c) => [c.timestamp, c]));
  const out: DatasetIssue[] = [];
  for (const c of next) {
    const p = byTs.get(c.timestamp);
    if (p && (p.open !== c.open || p.high !== c.high || p.low !== c.low || p.close !== c.close || p.volume !== c.volume)) {
      out.push({ kind: "CORRECTION", at: c.timestamp, detail: `revised from O${p.open} H${p.high} L${p.low} C${p.close} V${p.volume}` });
    }
  }
  return out;
}

const BLOCKING: readonly DatasetIssueKind[] = ["MISSING_BARS", "DUPLICATE", "OUT_OF_ORDER", "OUTSIDE_SESSION", "STALE"];

export function buildManifest(input: {
  kind: DatasetKind;
  provider: string;
  providerSymbol: string;
  canonicalSymbol: string;
  timeframe: Timeframe;
  from: number;
  to: number;
  acquiredAt: number;
  rawText: string;
  normalized: readonly TradingSession[];
  issues: readonly DatasetIssue[];
  license: DatasetLicense;
}): Readonly<DatasetManifest> {
  const normalizedSha256 = sha256Hex(canonicalJson(input.normalized));
  const rawSha256 = sha256Hex(input.rawText);
  const bars = input.normalized.reduce((n, s) => n + s.candles.length, 0);
  return deepFreeze({
    datasetId: `${input.provider}:${input.canonicalSymbol}:${input.timeframe}:${input.from}-${input.to}:${normalizedSha256.slice(0, 12)}`,
    kind: input.kind,
    provider: input.provider,
    providerSymbol: input.providerSymbol,
    canonicalSymbol: input.canonicalSymbol,
    timeframe: input.timeframe,
    from: input.from,
    to: input.to,
    acquiredAt: input.acquiredAt,
    rawSha256,
    normalizedSha256,
    bars,
    sessions: input.normalized.length,
    issues: [...input.issues],
    clean: !input.issues.some((i) => BLOCKING.includes(i.kind)),
    license: { ...input.license },
    engineVersion: KLYNGE_ENGINE_VERSION,
    ruleVersion: KLYNGE_RULE_VERSION,
  });
}

/** Re-verify stored artifacts against their manifest (tamper / corruption detection). */
export function verifyManifest(m: DatasetManifest, rawText: string, normalized: readonly TradingSession[]): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (sha256Hex(rawText) !== m.rawSha256) problems.push("raw records do not match the manifest hash");
  if (sha256Hex(canonicalJson(normalized)) !== m.normalizedSha256) problems.push("normalized data does not match the manifest hash");
  return { ok: problems.length === 0, problems };
}
