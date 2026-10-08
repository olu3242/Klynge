import { createHash } from "node:crypto";
import type { DecisionRecord } from "../store/types.ts";

/**
 * Real-market evidence ledger (Batch 73). A read-only, versioned projection of immutable decision records — it never
 * alters engine truth. Evidence classes are kept apart: synthetic fixtures, user screenshots (VISUAL — never OHLCV),
 * user-imported data (unverified provenance) and verified vendor data. Entries carry no prices or bars, so licensed
 * vendor data is never redistributed through the ledger; raw vendor records stay under the dataset retention policy.
 */
export type EvidenceClass = "SYNTHETIC_FIXTURE" | "USER_SCREENSHOT" | "USER_IMPORTED_DATA" | "VERIFIED_LIVE";
export const LEDGER_VERSION = "evidence-ledger-v1";

export interface EvidenceEntry {
  ledgerVersion: typeof LEDGER_VERSION;
  evidenceId: string;
  recordId: string;
  class: EvidenceClass;
  /** True only for vendor-verified DATA (never for screenshots, fixtures or imports). */
  verified: boolean;
  symbol: string;
  timeframe: string | null;
  evidenceMode: "VISUAL" | "DATA";
  /** DATA: the engine decision exactly as recorded. VISUAL: the visual permission (WAIT/BLOCKED) — never a setup. */
  outcome: string;
  regime: string | null;
  observedAt: number;
  marketTimestamp: number | null;
  engineVersion: string | null;
  ruleVersion: string | null;
  providers: { provider: string; providerSymbol: string; role: string; latestMarketTimestamp: number; normalized: boolean; warnings: number }[];
  dataQuality: { outcome: "VERIFIED" | "DEGRADED" | "NOT_APPLICABLE"; blockers: string[] };
  licensing: { pricesIncluded: false; redistribution: false };
}

const SYNTHETIC = /^mock/;

export function evidenceClass(r: DecisionRecord): EvidenceClass {
  if (r.evidenceMode === "VISUAL") return "USER_SCREENSHOT";
  const providers = r.marketData ?? [];
  if (providers.length === 0) return "USER_IMPORTED_DATA";
  return providers.some((p) => SYNTHETIC.test(p.provider)) ? "SYNTHETIC_FIXTURE" : "VERIFIED_LIVE";
}

export function evidenceEntry(r: DecisionRecord): EvidenceEntry {
  const cls = evidenceClass(r);
  const providers = (r.marketData ?? []).map((p) => ({ provider: p.provider, providerSymbol: p.providerSymbol, role: p.role, latestMarketTimestamp: p.latestMarketTimestamp, normalized: p.normalized, warnings: p.warnings.length }));
  const blockers = r.data ? [...r.data.blockers] : [];
  return {
    ledgerVersion: LEDGER_VERSION,
    evidenceId: `ev_${createHash("sha256").update(`${r.tenantId}|${r.recordId}`).digest("hex").slice(0, 24)}`,
    recordId: r.recordId,
    class: cls,
    verified: cls === "VERIFIED_LIVE",
    symbol: r.symbol,
    timeframe: r.timeframe,
    evidenceMode: r.evidenceMode,
    outcome: r.data ? r.data.decision : (r.visual?.permission ?? "UNKNOWN"),
    regime: r.data?.regime ?? r.visual?.regime ?? null,
    observedAt: r.at,
    marketTimestamp: r.marketTimestamp ?? null,
    engineVersion: r.data?.provenance.engineVersion ?? null,
    ruleVersion: r.data?.provenance.ruleVersion ?? null,
    providers,
    dataQuality: { outcome: r.evidenceMode === "VISUAL" ? "NOT_APPLICABLE" : providers.some((p) => !p.normalized || p.warnings > 0) ? "DEGRADED" : "VERIFIED", blockers },
    licensing: { pricesIncluded: false, redistribution: false },
  };
}

export function evidenceLedger(records: readonly DecisionRecord[]): EvidenceEntry[] {
  return [...records].sort((a, b) => a.at - b.at || a.recordId.localeCompare(b.recordId)).map(evidenceEntry);
}
