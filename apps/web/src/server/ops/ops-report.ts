import { createHash } from "node:crypto";
import { KLYNGE_ENGINE_VERSION, KLYNGE_RULE_HISTORY, KLYNGE_RULE_VERSION } from "../engine-core.ts";
import type { DatasetManifest, RuntimeState, StateAlert } from "../engine-core.ts";
import type { AuditEntry, OutboxItem } from "../account/types.ts";
import type { MarketDataSetup } from "../market-data.ts";
import type { WorkerRun } from "../notifications/worker.ts";
import type { DecisionRecord } from "../store/types.ts";

/**
 * Operator monitoring (Batch 69). Cross-tenant AGGREGATES only: no tenant ids, emails, message content, prices,
 * thresholds, formulas or credentials. Every incident links a deterministic runbook.
 */
export type IncidentCode = "PROVIDER_DOWN" | "MISSING_FEED" | "STALE_SESSION" | "CORRUPTED_RUNTIME" | "DUPLICATE_PROCESSING" | "DEAD_LETTER" | "DELIVERY_BACKLOG" | "LEASE_CONTENTION" | "INGESTION_FAILURE";
export interface Incident {
  code: IncidentCode;
  severity: "WARNING" | "CRITICAL";
  count: number;
  summary: string;
  runbook: string;
}

export interface OpsInputs {
  now: number;
  storeMode: string;
  /** IN_PROCESS: full aggregates. PROVIDER_ONLY: hosted store — cross-tenant aggregates never run on a request path. */
  scope: "IN_PROCESS" | "PROVIDER_ONLY";
  market: MarketDataSetup | null;
  records: readonly DecisionRecord[];
  runtime: readonly (RuntimeState & { tenantId: string })[];
  alerts: readonly (StateAlert & { tenantId: string })[];
  outbox: readonly OutboxItem[];
  audit: readonly AuditEntry[];
  workerRuns: readonly WorkerRun[];
  datasets: readonly (DatasetManifest & { verified: boolean })[] | null;
}

export interface OpsReport {
  generatedAt: number;
  engineVersion: string;
  ruleVersion: string;
  storeMode: string;
  scope: OpsInputs["scope"];
  status: "OPERATIONAL" | "DEGRADED" | "DOWN";
  providers: { provider: string; status: string; lastSuccessAt: number | null; lastFailureCode: string | null }[];
  feeds: { role: "SPX" | "MNQ"; licensed: boolean }[];
  sessions: { tenants: number; dataRecords: number; visualRecords: number; runtimeCursors: number; stale: number; corrupted: number; marketOpen: boolean | null };
  runtimeFailures24h: number;
  delivery: { pending: number; delivered: number; failed: number; suppressed: number; oldestDueMinutes: number | null; workerRuns: number; lastRunAt: number | null; leaseLost: number };
  ingestion: { datasets: number; unclean: number; unverified: number; superseded: number } | null;
  auditActions: Record<string, number>;
  incidents: Incident[];
}

export const STALE_SESSION_MS = 20 * 60_000;
const DECISIONS = new Set(["WAIT", "BLOCKED", "INVALIDATED", "CALL_SETUP", "PUT_SETUP"]);
const RULES: ReadonlySet<string> = new Set(KLYNGE_RULE_HISTORY.map((r) => r.ruleVersion));
const RB = (f: string, a: string) => `docs/runbooks/${f}.md#${a}`;

/** A runtime cursor is corrupted when it cannot be a faithful pointer to a stored, versioned decision. */
export function runtimeCorruption(c: RuntimeState & { tenantId: string }, records: readonly DecisionRecord[], now: number): string | null {
  if (!Number.isFinite(c.lastMarketTimestamp) || c.lastMarketTimestamp <= 0) return "invalid market timestamp";
  if (c.lastMarketTimestamp > now + 5 * 60_000) return "market timestamp in the future";
  if (!DECISIONS.has(c.lastDecision)) return "unknown decision";
  if (!RULES.has(c.ruleVersion)) return "unknown rule version";
  if (typeof c.lastMarketKey !== "string" || c.lastMarketKey.length < 8) return "missing idempotency key";
  if (!records.some((r) => r.tenantId === c.tenantId && r.recordId === c.lastRecordId)) return "points at a missing decision record";
  return null;
}

export function opsReport(i: OpsInputs): OpsReport {
  const now = i.now;
  const health = (i.market?.health?.() ?? []).map((h) => ({ provider: h.provider, status: h.status, lastSuccessAt: h.lastSuccessAt, lastFailureCode: h.lastFailureCode }));
  const ent = new Set((i.market?.entitlements ?? []).map((e) => e.canonicalSymbol));
  const feeds = (["SPX", "MNQ"] as const).map((role) => ({ role, licensed: i.market ? (i.market.live ? ent.has(role) : true) : false }));
  const status = i.market?.calendar.status?.(now);
  const marketOpen = status === undefined ? null : status === "OPEN";
  const corrupted = i.runtime.filter((c) => runtimeCorruption(c, i.records, now) !== null);
  const stale = marketOpen ? i.runtime.filter((c) => !corrupted.includes(c) && now - c.lastMarketTimestamp > STALE_SESSION_MS) : [];
  const dataKey = new Map<string, number>();
  for (const r of i.records) if (r.evidenceMode === "DATA" && r.runtimeId && r.marketTimestamp !== undefined) dataKey.set(`${r.tenantId}|${r.runtimeId}|${r.marketTimestamp}`, (dataKey.get(`${r.tenantId}|${r.runtimeId}|${r.marketTimestamp}`) ?? 0) + 1);
  const duplicates = [...dataKey.values()].filter((n) => n > 1).length;
  const count = (s: OutboxItem["status"]) => i.outbox.filter((o) => o.status === s).length;
  const due = i.outbox.filter((o) => o.status === "PENDING" && o.nextAttemptAt <= now);
  const oldestDue = due.length ? Math.floor((now - Math.min(...due.map((o) => o.nextAttemptAt))) / 60_000) : null;
  const leaseLost = i.workerRuns.reduce((n, r) => n + r.leaseLost, 0);
  const ingestion = i.datasets ? { datasets: i.datasets.length, unclean: i.datasets.filter((d) => !d.clean).length, unverified: i.datasets.filter((d) => !d.verified).length, superseded: i.datasets.filter((d) => i.datasets!.some((x) => x.supersedes === d.datasetId)).length } : null;
  const incidents: Incident[] = [];
  const add = (code: IncidentCode, severity: Incident["severity"], n: number, summary: string, runbook: string) => n > 0 && incidents.push({ code, severity, count: n, summary, runbook });
  add("PROVIDER_DOWN", "CRITICAL", health.filter((h) => h.status === "DOWN").length, "Market-data provider unavailable — DATA evaluations fail closed (BLOCKED).", RB("provider-outage", "provider-down"));
  add("PROVIDER_DOWN", "WARNING", health.filter((h) => h.status === "DEGRADED").length, "Market-data provider degraded (retries / rate limits).", RB("provider-outage", "degraded"));
  add("MISSING_FEED", "CRITICAL", feeds.filter((f) => !f.licensed).length, "A required context feed (SPX or MNQ) is not licensed — no substitution is made; evaluations BLOCK.", RB("provider-outage", "missing-feed"));
  add("STALE_SESSION", "WARNING", stale.length, "Runtime cursors not advanced while the market is open.", RB("stale-data", "stale-sessions"));
  add("CORRUPTED_RUNTIME", "CRITICAL", corrupted.length, "Runtime cursors fail integrity checks — quarantine and re-evaluate from verified data.", RB("runtime-recovery", "corrupted-cursor"));
  add("DUPLICATE_PROCESSING", "CRITICAL", duplicates, "More than one DATA record for the same runtime and bar.", RB("runtime-recovery", "duplicate-processing"));
  add("DEAD_LETTER", "WARNING", count("FAILED"), "Notifications exhausted retries (dead letter).", RB("notification-worker", "dead-letters"));
  add("DELIVERY_BACKLOG", "WARNING", oldestDue !== null && oldestDue > 30 ? due.length : 0, "Due notifications waiting more than 30 minutes — is the worker scheduled?", RB("notification-worker", "backlog"));
  add("LEASE_CONTENTION", "WARNING", leaseLost, "Worker completions rejected by lease fencing (overlap or slow runs). No duplicate sends: provider idempotency key.", RB("notification-worker", "lease-contention"));
  add("INGESTION_FAILURE", "WARNING", (ingestion?.unclean ?? 0) + (ingestion?.unverified ?? 0), "Historical datasets unclean or failing hash verification — excluded from calibration.", RB("stale-data", "ingestion"));
  const auditActions: Record<string, number> = {};
  for (const a of i.audit) auditActions[a.action] = (auditActions[a.action] ?? 0) + 1;
  return {
    generatedAt: now,
    engineVersion: KLYNGE_ENGINE_VERSION,
    ruleVersion: KLYNGE_RULE_VERSION,
    storeMode: i.storeMode,
    scope: i.scope,
    status: incidents.some((x) => x.severity === "CRITICAL") ? (health.length > 0 && health.every((h) => h.status === "DOWN") ? "DOWN" : "DEGRADED") : incidents.length ? "DEGRADED" : "OPERATIONAL",
    providers: health,
    feeds,
    sessions: { tenants: new Set(i.records.map((r) => r.tenantId)).size, dataRecords: i.records.filter((r) => r.evidenceMode === "DATA").length, visualRecords: i.records.filter((r) => r.evidenceMode === "VISUAL").length, runtimeCursors: i.runtime.length, stale: stale.length, corrupted: corrupted.length, marketOpen },
    runtimeFailures24h: i.alerts.filter((a) => a.event === "PROVIDER_FAILURE" && now - a.at < 86_400_000).length,
    delivery: { pending: count("PENDING"), delivered: count("DELIVERED"), failed: count("FAILED"), suppressed: count("SUPPRESSED"), oldestDueMinutes: oldestDue, workerRuns: i.workerRuns.length, lastRunAt: i.workerRuns.at(-1)?.startedAt ?? null, leaseLost },
    ingestion,
    auditActions: Object.fromEntries(Object.entries(auditActions).sort(([a], [b]) => a.localeCompare(b))),
    incidents,
  };
}

/** Structured operator audit event (no PII): who is a hashed reference, never an email or tenant id. */
export function operatorRef(userId: string): string {
  return `op_${createHash("sha256").update(`klynge-operator|${userId}`).digest("hex").slice(0, 12)}`;
}
