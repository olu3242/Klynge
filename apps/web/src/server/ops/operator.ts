import path from "node:path";
import { existsSync } from "node:fs";
import type { MemoryAccountStore } from "../account/memory-account-store.ts";
import type { AuditEntry } from "../account/types.ts";
import { DatasetStore } from "../history/pipeline.ts";
import type { Identity } from "../identity.ts";
import type { MarketDataSetup } from "../market-data.ts";
import { memoryQueueFor } from "../notifications/queue-registry.ts";
import type { MemorySessionStore } from "../store/memory-store.ts";
import { isTestMode } from "../test-mode.ts";
import { opsReport, runtimeCorruption } from "./ops-report.ts";
import type { OpsReport } from "./ops-report.ts";

/**
 * Operator (administrator) access. Server-derived only: a VERIFIED user whose email is in the server-only
 * KLYNGE_ADMIN_EMAILS allowlist AND — on Supabase — whose app_metadata.klynge_role is "admin" (settable only with the
 * service role). Mock auth qualifies only in test mode. Never granted by request bodies, query strings or headers.
 */
export function isOperator(identity: Identity, gatewayKind: "supabase" | "mock" | "disabled", env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  if (identity.kind !== "USER" || !identity.user.email) return false;
  const allow = (env.KLYNGE_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!allow.includes(identity.user.email.toLowerCase())) return false;
  if (gatewayKind === "supabase") return identity.user.appRole === "admin";
  return gatewayKind === "mock" && isTestMode(env);
}

export interface OpsDeps {
  storeMode: string;
  durable: MemorySessionStore | null;
  account: MemoryAccountStore | null;
  market: MarketDataSetup | null;
}

export function collectOpsReport(d: OpsDeps, now: number, env: Readonly<Record<string, string | undefined>> = process.env): OpsReport {
  const snap = d.durable?.infrastructureSnapshot() ?? { records: [], runtime: [], alerts: [] };
  const outbox = d.account?.allOutbox() ?? [];
  const audit: AuditEntry[] = d.account?.allAudit() ?? [];
  const dir = env.KLYNGE_DATASET_DIR ? path.resolve(env.KLYNGE_DATASET_DIR) : null;
  let datasets = null;
  if (dir && existsSync(path.join(dir, "manifests"))) {
    const store = new DatasetStore(dir);
    datasets = store.manifests().map((m) => ({ ...m, verified: store.verify(m.datasetId).ok }));
  }
  return opsReport({
    now,
    storeMode: d.storeMode,
    scope: d.durable ? "IN_PROCESS" : "PROVIDER_ONLY",
    market: d.market,
    records: snap.records,
    runtime: snap.runtime,
    alerts: snap.alerts,
    outbox,
    audit,
    workerRuns: d.account ? memoryQueueFor(d.account).runs : [],
    datasets,
  });
}

/** Deterministic recovery: quarantine every corrupted runtime cursor; the next verified evaluation rebuilds it. */
export function quarantineCorruptedRuntime(store: MemorySessionStore, now: number): number {
  const snap = store.infrastructureSnapshot();
  let n = 0;
  for (const c of snap.runtime) if (runtimeCorruption(c, snap.records, now) && store.quarantineRuntimeState(c.tenantId, c.runtimeId)) n++;
  return n;
}
