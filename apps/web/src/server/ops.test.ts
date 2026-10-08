import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KLYNGE_RULE_VERSION } from "./engine-core.ts";
import type { RuntimeState } from "./engine-core.ts";
import { MemoryAccountStore } from "./account/memory-account-store.ts";
import type { OutboxItem } from "./account/types.ts";
import type { Identity } from "./identity.ts";
import type { MarketDataSetup } from "./market-data.ts";
import { collectOpsReport, isOperator, quarantineCorruptedRuntime } from "./ops/operator.ts";
import { opsReport, runtimeCorruption } from "./ops/ops-report.ts";
import type { OpsInputs } from "./ops/ops-report.ts";
import { MemorySessionStore } from "./store/memory-store.ts";
import type { DecisionRecord } from "./store/types.ts";
import { T, USER_A, USER_B } from "./test-support.ts";

const user = (email: string | null, appRole: string | null = null): Identity => ({ kind: "USER", user: { id: USER_A, email, method: "google", appRole }, tenantId: USER_A, sessionId: "s", trialTenantId: null });
const TEST_ENV = { KLYNGE_TEST_MODE: "1", KLYNGE_ADMIN_EMAILS: "ops@example.com" };

describe("operator access (Batch 69)", () => {
  it("requires a verified, allow-listed user; Supabase additionally requires app_metadata.klynge_role=admin", () => {
    assert.equal(isOperator({ kind: "TRIAL", tenantId: "trial:x", sessionId: "s" }, "mock", TEST_ENV), false);
    assert.equal(isOperator(user("ada@example.com"), "mock", TEST_ENV), false);
    assert.equal(isOperator(user("OPS@example.com"), "mock", TEST_ENV), true);
    assert.equal(isOperator(user("ops@example.com"), "mock", { KLYNGE_ADMIN_EMAILS: "ops@example.com" }), false, "mock auth outside test mode never qualifies");
    assert.equal(isOperator(user("ops@example.com"), "supabase", TEST_ENV), false, "allowlist alone is not enough on Supabase");
    assert.equal(isOperator(user("ops@example.com", "admin"), "supabase", TEST_ENV), true);
    assert.equal(isOperator(user("ops@example.com", "admin"), "supabase", {}), false, "no allowlist => nobody");
    assert.equal(isOperator(user(null, "admin"), "supabase", TEST_ENV), false);
  });
});

const rec = (tenantId: string, recordId: string, marketTimestamp: number, runtimeId = "rt-1"): DecisionRecord => ({ recordId, tenantId, sessionId: "s", symbol: "TSLA", timeframe: "5m", evidenceMode: "DATA", at: marketTimestamp, marketTimestamp, runtimeId });
const cursor = (tenantId: string, over: Partial<RuntimeState> = {}): RuntimeState & { tenantId: string } => ({ tenantId, runtimeId: "rt-1", targetSymbol: "TSLA", lastMarketTimestamp: T - 60_000, lastMarketKey: "k".repeat(16), lastRecordId: "r1", lastDecision: "WAIT", lastOptionsDecision: null, lastEventId: null, updatedAt: T, ruleVersion: KLYNGE_RULE_VERSION, ...over });
const market = (over: Partial<MarketDataSetup> = {}): MarketDataSetup => ({ label: "test", live: true, calendar: { status: () => "OPEN" }, health: () => [{ provider: "polygon", status: "HEALTHY", lastSuccessAt: T, lastFailureCode: null }], entitlements: [{ canonicalSymbol: "SPX", providerSymbol: "I:SPX", timeframes: ["5m"], assetClass: "index" }, { canonicalSymbol: "MNQ", providerSymbol: "CME:MNQ", timeframes: ["5m"], assetClass: "cme futures" }], ...over }) as unknown as MarketDataSetup;
const outbox = (status: OutboxItem["status"], nextAttemptAt = T): OutboxItem => ({ notificationId: `n-${status}-${nextAttemptAt}`, tenantId: USER_B, alertId: "a", channel: "email", event: "CALL_SETUP", symbol: "TSLA", subject: "s", text: "t", to: "bob@example.com", status, attempts: 0, nextAttemptAt, createdAt: T, deliveredAt: null, lastError: null });
const base = (over: Partial<OpsInputs> = {}): OpsInputs => ({ now: T, storeMode: "memory", scope: "IN_PROCESS", market: market(), records: [rec(USER_A, "r1", T - 60_000)], runtime: [cursor(USER_A)], alerts: [], outbox: [outbox("DELIVERED")], audit: [{ auditId: "x", tenantId: USER_A, at: T, action: "auth.sign_in", detail: "Google" }], workerRuns: [], datasets: null, ...over });
const codes = (i: OpsInputs) => opsReport(i).incidents.map((x) => x.code);

describe("operational monitoring + incident detection (Batch 69)", () => {
  it("healthy inputs => OPERATIONAL with no incidents", () => {
    const r = opsReport(base());
    assert.equal(r.status, "OPERATIONAL");
    assert.deepEqual(r.incidents, []);
    assert.deepEqual(r.feeds, [{ role: "SPX", licensed: true }, { role: "MNQ", licensed: true }]);
  });
  it("detects corrupted runtime cursors deterministically", () => {
    for (const [over, why] of [[{ lastRecordId: "gone" }, /missing decision/], [{ lastMarketTimestamp: T + 3_600_000 }, /future/], [{ ruleVersion: "tampered-v9" }, /rule version/], [{ lastDecision: "BUY" as never }, /unknown decision/], [{ lastMarketKey: "" }, /idempotency/]] as const) {
      assert.match(runtimeCorruption(cursor(USER_A, over), [rec(USER_A, "r1", T)], T) ?? "", why);
    }
    assert.equal(runtimeCorruption(cursor(USER_B), [rec(USER_A, "r1", T)], T), "points at a missing decision record", "records are matched within the tenant");
    assert.deepEqual(codes(base({ runtime: [cursor(USER_A, { lastRecordId: "gone" })] })), ["CORRUPTED_RUNTIME"]);
  });
  it("detects stale sessions only while the market is open", () => {
    const old = base({ runtime: [cursor(USER_A, { lastMarketTimestamp: T - 3_600_000 })], records: [rec(USER_A, "r1", T - 3_600_000)] });
    assert.deepEqual(codes(old), ["STALE_SESSION"]);
    assert.deepEqual(codes({ ...old, market: market({ calendar: { status: () => "CLOSED" } } as never) }), []);
  });
  it("detects duplicate processing, dead letters, backlog, lease contention", () => {
    assert.deepEqual(codes(base({ records: [rec(USER_A, "r1", T - 60_000), rec(USER_A, "r1-dup", T - 60_000)] })), ["DUPLICATE_PROCESSING"]);
    assert.deepEqual(codes(base({ outbox: [outbox("FAILED")] })), ["DEAD_LETTER"]);
    assert.deepEqual(codes(base({ outbox: [outbox("PENDING", T - 45 * 60_000)] })), ["DELIVERY_BACKLOG"]);
    assert.deepEqual(codes(base({ workerRuns: [{ runId: "r", workerId: "w", startedAt: T, finishedAt: T, claimed: 1, delivered: 0, failed: 0, deferred: 0, suppressed: 0, leaseLost: 1 }] })), ["LEASE_CONTENTION"]);
  });
  it("detects provider outages and missing context feeds (no substitution)", () => {
    const down = opsReport(base({ market: market({ health: () => [{ provider: "polygon", status: "DOWN", lastSuccessAt: null, lastFailureCode: "PROVIDER_UNAVAILABLE" }] } as never) }));
    assert.equal(down.status, "DOWN");
    const noMnq = opsReport(base({ market: market({ entitlements: [{ canonicalSymbol: "SPX", providerSymbol: "I:SPX", timeframes: ["5m"], assetClass: "index" }, { canonicalSymbol: "NQ", providerSymbol: "CME:NQ", timeframes: ["5m"], assetClass: "x" }] } as never) }));
    assert.deepEqual(noMnq.feeds, [{ role: "SPX", licensed: true }, { role: "MNQ", licensed: false }], "NQ never stands in for MNQ");
    assert.equal(noMnq.status, "DEGRADED");
  });
  it("ingestion failures are surfaced", () => {
    const m = { datasetId: "d1", clean: false, verified: true, supersedes: null } as never;
    assert.deepEqual(codes(base({ datasets: [m] })), ["INGESTION_FAILURE"]);
  });
  it("reports aggregates only: no tenant ids, emails, message content or credentials", () => {
    const r = JSON.stringify(opsReport(base({ outbox: [outbox("FAILED")], runtime: [cursor(USER_A, { lastRecordId: "gone" })] })));
    for (const leak of [USER_A, USER_B, "bob@example.com", "\"subject\"", "lastMarketKey", "apiKey", "SERVICE_ROLE"]) assert.ok(!r.includes(leak), leak);
  });
});

describe("deterministic recovery (Batch 69)", () => {
  it("quarantines only corrupted cursors; the report clears; healthy cursors are untouched", async () => {
    const store = new MemorySessionStore();
    const account = new MemoryAccountStore();
    await store.putRecord(rec(USER_A, "r1", T - 60_000));
    await store.putRuntimeState(USER_A, cursor(USER_A));
    await store.putRuntimeState(USER_B, cursor(USER_B, { runtimeId: "rt-2", lastRecordId: "gone" }));
    const deps = { storeMode: "memory", durable: store, account, market: market() };
    assert.equal(collectOpsReport(deps, T, {}).sessions.corrupted, 1);
    assert.equal(quarantineCorruptedRuntime(store, T), 1);
    assert.equal(quarantineCorruptedRuntime(store, T), 0, "idempotent");
    const after = collectOpsReport(deps, T, {});
    assert.deepEqual([after.sessions.corrupted, after.sessions.runtimeCursors], [0, 1]);
    assert.ok(await store.getRuntimeState(USER_A, "rt-1"));
  });
});

describe("runbooks (Batch 69)", () => {
  it("every incident runbook link resolves to an existing section", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const src = readFileSync(path.join(import.meta.dirname, "ops/ops-report.ts"), "utf8");
    const links = [...src.matchAll(/RB\("([a-z-]+)", "([a-z-]+)"\)/g)];
    assert.ok(links.length >= 10);
    for (const [, file, anchor] of links) {
      const md = readFileSync(path.join(import.meta.dirname, "../../../../docs/runbooks", `${file}.md`), "utf8");
      const anchors = [...md.matchAll(/^##+ (.+)$/gm)].map((m) => m[1]!.toLowerCase().replace(/[^a-z0-9 -]/g, "").replace(/ /g, "-"));
      assert.ok(anchors.includes(anchor!), `${file}#${anchor}`);
    }
  });
});

describe("bundle guard covers 0.7.0 internals (Batches 61–70)", () => {
  it("flags evaluation, futures, worker and operator internals plus CME credentials", async () => {
    const { mkdirSync, mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const { pathToFileURL } = await import("node:url");
    const { APP_ROOT } = await import("./test-support.ts");
    const mod = (await import(pathToFileURL(path.join(APP_ROOT, "scripts/check-client-bundle.mjs")).href)) as { scan: (dir: string) => string[] };
    const dir = mkdtempSync(path.join(tmpdir(), "klynge-bundle4-"));
    mkdirSync(path.join(dir, "chunks"));
    for (const leak of ["pilot-readiness-v1", "sealHoldout", "outOfSampleReport", "activeContract", "aggregateBars", "runNotificationWorker", "klynge_claim_notifications", "runtimeCorruption", "KLYNGE_ADMIN_EMAILS", "DATABENTO_API_KEY", "hist.databento.com"]) {
      writeFileSync(path.join(dir, "chunks/leak.js"), `var x=${JSON.stringify(leak)};`);
      assert.ok(mod.scan(dir).length >= 1, leak);
    }
  });
});
