import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Candle, MarketDataProvider } from "./engine-core.ts";
import { MemoryAccountStore } from "./account/memory-account-store.ts";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "./account/types.ts";
import { withScenario } from "./market-data.ts";
import { queueAlertNotification } from "./notifications/dispatcher.ts";
import { MockEmailProvider } from "./notifications/email.ts";
import { MemoryNotificationQueue, runNotificationWorker } from "./notifications/worker.ts";
import { pilotGateVerdict } from "./pilot/access.ts";
import type { SessionStore } from "./store/types.ts";
import { corpusImage, FIXTURE_END, marketDeps, MIN, testDeps, trialDeps, USER_A } from "./test-support.ts";
import { connectData, getWorkspace, uploadChart, WorkspaceError } from "./workspace.ts";
import type { WorkspaceDeps } from "./workspace.ts";

/**
 * Batch 76 — failure injection. Every failure must end in a SAFE, EXPLAINABLE state: no fabricated market continuity,
 * no new CALL_SETUP/PUT_SETUP record, a plain reason for the user, and recovery that is deterministic and idempotent.
 */
const SID = "77777777-7777-4777-a777-777777777777";
const END = FIXTURE_END;
const upload = (d: WorkspaceDeps, id: string, now = END - 5 * MIN) => uploadChart(d, { tenantId: USER_A, sessionId: SID, bytes: corpusImage(id), hints: {}, actor: "user", now });
const connect = (d: WorkspaceDeps, now = END) => connectData(d, { tenantId: USER_A, sessionId: SID, now });
const directional = async (d: WorkspaceDeps) => (await d.store.listRecords(USER_A)).filter((r) => r.data && (r.data.decision === "CALL_SETUP" || r.data.decision === "PUT_SETUP")).length;

/** Wraps a provider and rewrites the bars for one provider symbol (timestamp disagreement / truncation). */
function tamper(p: MarketDataProvider, providerSymbol: string, f: (bars: Candle[]) => Candle[]): MarketDataProvider {
  const wrap = async (r: Awaited<ReturnType<MarketDataProvider["getHistoricalCandles"]>>, sym: string) => (r.ok && sym === providerSymbol ? { ...r, value: f(r.value) } : r);
  return { id: p.id, getHistoricalCandles: async (i) => wrap(await p.getHistoricalCandles(i), i.providerSymbol), getLatestCandles: async (i) => wrap(await p.getLatestCandles(i), i.providerSymbol) };
}

describe("failure injection — market data (Batch 76)", () => {
  for (const scenario of ["outage", "stale", "missing-bar", "rate-limited"] as const) {
    it(`${scenario}: BLOCKED/WAIT with a plain reason, no directional record`, async () => {
      const base = marketDeps();
      const d = { ...base, market: withScenario(base.market, scenario) };
      await upload(d, "tsla-5m-bull");
      const v = await connect(d);
      assert.ok(v.runtime && ["BLOCKED", "WAIT"].includes(v.runtime.status), `${scenario}: ${v.runtime?.status}`);
      assert.ok((v.runtime?.reasons ?? []).length > 0, "explainable");
      assert.equal(await directional(d), 0);
    });
  }
  it("timestamp disagreement: MNQ feed lags the others => BLOCKED, never stitched", async () => {
    const base = marketDeps();
    const d = { ...base, market: { ...base.market, provider: tamper(base.market.provider, "MNQ1!", (bars) => bars.slice(0, -6)) } };
    await upload(d, "tsla-5m-bull");
    const v = await connect(d);
    assert.equal(v.runtime?.status, "BLOCKED", JSON.stringify(v.runtime?.reasons));
    assert.equal(await directional(d), 0);
  });
  it("missing candle inside a session => BLOCKED (never filled)", async () => {
    const base = marketDeps();
    const d = { ...base, market: { ...base.market, provider: tamper(base.market.provider, "I:SPX", (bars) => bars.filter((_, i) => i !== bars.length - 20)) } };
    await upload(d, "tsla-5m-bull");
    assert.equal((await connect(d)).runtime?.status, "BLOCKED");
    assert.equal(await directional(d), 0);
  });
  it("incomplete chart set (VISUAL) => context only, never a setup", async () => {
    const d = testDeps();
    const v = await upload(d, "tsla-5m-bull", 1_780_000_000_000);
    assert.equal(v.visual?.label, "INSUFFICIENT CONTEXT");
    assert.ok(v.visual && ["WAIT", "BLOCKED"].includes(v.visual.permission));
    assert.equal(await directional(d), 0);
  });
  it("out-of-order data never overwrites a newer decision", async () => {
    const d = marketDeps();
    await upload(d, "tsla-5m-bull");
    await connect(d, END);
    const before = (await d.store.listRecords(USER_A)).length;
    const older = await connect(d, END - 15 * MIN);
    assert.equal(older.runtime?.status, "BLOCKED");
    assert.match((older.runtime?.reasons ?? []).join(" "), /out of order/i);
    assert.equal((await d.store.listRecords(USER_A)).length, before);
  });
  it("duplicate + concurrent processing of one market state => exactly one record, no duplicate alerts", async () => {
    const seq = marketDeps();
    await upload(seq, "tsla-5m-bull");
    await connect(seq);
    const alertsSequential = (await seq.store.listAlerts(USER_A)).length;
    const d = marketDeps();
    await upload(d, "tsla-5m-bull");
    await Promise.all([connect(d), connect(d), connect(d)]);
    await connect(d);
    assert.equal((await d.store.listRecords(USER_A)).filter((r) => r.evidenceMode === "DATA").length, 1);
    assert.equal((await d.store.listAlerts(USER_A)).length, alertsSequential);
  });
});

describe("failure injection — auth, database, restart, worker (Batch 76)", () => {
  it("expired/revoked auth falls back to an anonymous trial: durable actions refused; invite-only asks to sign in", async () => {
    const d = { ...trialDeps(), market: marketDeps().market };
    await assert.rejects(connectData(d, { tenantId: "trial:x", sessionId: SID, now: END, symbol: "TSLA" }), (e: unknown) => e instanceof WorkspaceError && e.code === "AUTH_REQUIRED");
    assert.equal(pilotGateVerdict("invite-only", "TRIAL", null, false), "SIGN_IN_REQUIRED");
  });
  it("database failure mid-cycle: BLOCKED with an explanation; nothing partial; retry is idempotent", async () => {
    const d = marketDeps();
    await upload(d, "tsla-5m-bull");
    const real = d.store;
    let fail = true;
    const flaky: SessionStore = new Proxy(real, {
      get(t, k) {
        const v = Reflect.get(t, k, t) as unknown;
        if (k === "putRecord" && typeof v === "function") return async (...a: unknown[]) => (fail ? Promise.reject(new Error("connection reset by peer (db)")) : (v as (...x: unknown[]) => unknown).apply(t, a));
        return typeof v === "function" ? (v as (...x: unknown[]) => unknown).bind(t) : v;
      },
    });
    const fd = { ...d, store: flaky };
    const failed = await connect(fd);
    assert.equal(failed.runtime?.status, "BLOCKED", "fails closed");
    assert.match((failed.runtime?.reasons ?? []).join(" "), /unavailable; nothing was reconstructed/);
    assert.doesNotMatch(JSON.stringify(failed), /connection reset/, "infrastructure details never reach the user");
    assert.equal((await real.listRecords(USER_A)).filter((r) => r.evidenceMode === "DATA").length, 0, "no partial DATA record");
    fail = false;
    assert.equal((await connect(fd)).runtime?.status, "DATA_VERIFIED", "recovers deterministically");
    await connect(fd);
    assert.equal((await real.listRecords(USER_A)).filter((r) => r.evidenceMode === "DATA").length, 1);
  });
  it("runtime restart: a fresh process over the same durable state restores the previous decision (no blank state)", async () => {
    const d = marketDeps();
    await upload(d, "tsla-5m-bull");
    await connect(d);
    const restarted = { ...marketDeps(), store: d.store };
    const v = await getWorkspace(restarted, USER_A, SID);
    assert.equal(v.data?.decision, "CALL_SETUP");
    const again = await connect(restarted, END + MIN);
    assert.ok(["UNCHANGED", "DATA_VERIFIED"].includes(again.runtime?.status ?? ""), again.runtime?.status);
  });
  it("notification worker crashes between claim and completion: rows recover after the lease; one email", async () => {
    const a = new MemoryAccountStore();
    await a.putNotificationPrefs(USER_A, { ...DEFAULT_NOTIFICATION_PREFERENCES, email: { ...DEFAULT_NOTIFICATION_PREFERENCES.email, enabled: true, address: "ada@example.com", minSeverity: "INFO" } }, 0);
    await queueAlertNotification(a, USER_A, { alertId: "x:1", event: "CALL_SETUP", symbol: "TSLA", evidenceMode: "DATA", from: "WAIT", to: "CALL_SETUP", at: 1, severity: "ATTENTION", message: "m" }, 1);
    const q = new MemoryNotificationQueue(a);
    const email = new MockEmailProvider();
    const crashing = { ...q, kind: q.kind, claim: q.claim.bind(q), context: q.context.bind(q), audit: q.audit.bind(q), recordRun: q.recordRun.bind(q), complete: async () => Promise.reject(new Error("worker killed")) };
    await assert.rejects(runNotificationWorker(crashing, email, { workerId: "w1", now: 10 }));
    assert.equal(email.sent.length, 1, "sent before the crash");
    assert.equal((await runNotificationWorker(q, email, { workerId: "w2", now: 20 })).claimed, 0, "lease still held");
    const r = await runNotificationWorker(q, email, { workerId: "w2", now: 10 + 120_001 });
    assert.equal(r.delivered, 1);
    assert.equal(email.sent.length, 1, "provider idempotency key prevents a second email");
  });
});
