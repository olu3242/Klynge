import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { withScenario } from "./market-data.ts";
import { FileSessionStore } from "./store/file-store.ts";
import { corpusImage, FIXTURE_END, marketDeps, MIN, testDeps, USER_A } from "./test-support.ts";
import { connectData, getWorkspace, uploadChart, WorkspaceError } from "./workspace.ts";
import type { WorkspaceDeps } from "./workspace.ts";

const SID = "77777777-7777-4777-a777-777777777777";
const END = FIXTURE_END;
const connect = (deps: WorkspaceDeps, now = END, symbol?: string) => connectData(deps, { tenantId: USER_A, sessionId: SID, now, ...(symbol ? { symbol } : {}) });
const upload = (deps: WorkspaceDeps, id: string, now: number) => uploadChart(deps, { tenantId: USER_A, sessionId: SID, bytes: corpusImage(id), hints: {}, actor: "user", now });

describe("VISUAL → DATA handoff in the workspace", () => {
  it("chart session hints the symbol; verified data runs the full engine; the mode change is visible", async () => {
    const deps = marketDeps();
    const visual = await upload(deps, "tsla-5m-bull", END - 5 * MIN);
    assert.deepEqual([visual.evidence.mode, visual.evidence.title, visual.evidence.detail], ["VISUAL", "VISUAL ANALYSIS", "Conditions observed · Data verification required"]);
    const v = await connect(deps);
    assert.equal(v.runtime?.status, "DATA_VERIFIED");
    assert.equal(v.data?.decision, "CALL_SETUP");
    assert.equal(v.data?.source, "PROVIDER");
    assert.deepEqual(v.data?.provenance.map((p) => [p.role, p.canonicalSymbol, p.providerSymbol]), [["TARGET", "TSLA", "TSLA"], ["SPX", "SPX", "I:SPX"], ["MNQ", "MNQ", "MNQ1!"]]);
    assert.deepEqual([v.evidence.mode, v.evidence.title, v.evidence.detail, v.evidence.changedFrom], ["DATA", "DATA VERIFIED", "Deterministic Klynge engine active", "VISUAL"]);
    assert.equal(v.visual?.permission, "WAIT", "visual card stays observation-only");
    assert.ok(v.alerts.some((a) => a.message.includes("verified market data connected")));
    const rec = (await deps.store.listRecords(USER_A)).find((r) => r.evidenceMode === "DATA");
    assert.deepEqual(Object.keys(rec?.handoff ?? {}).sort(), ["createdAt", "fromEvidenceMode", "fromSessionId", "intent", "symbolHint", "timeframeHint"]);
    assert.equal(v.data?.options?.decision !== "ELIGIBLE", true, "options downstream; no chain => nothing eligible");
  });
  it("explicit symbol works without a chart; no chart and no symbol is rejected", async () => {
    const deps = marketDeps();
    assert.equal((await connect(deps, END, "tsla")).data?.decision, "CALL_SETUP");
    await assert.rejects(connect(marketDeps()), (e: unknown) => e instanceof WorkspaceError && e.code === "INVALID");
    await assert.rejects(connect(marketDeps(), END, "not a symbol"), /valid symbol/);
    await assert.rejects(connect(testDeps(), END, "TSLA"), /No verified market-data provider/);
  });
  it("unknown symbol => BLOCKED with a plain reason, no decision fabricated", async () => {
    const deps = marketDeps();
    const v = await connect(deps, END, "NVDA");
    assert.equal(v.runtime?.status, "BLOCKED");
    assert.ok(v.runtime?.reasons[0]?.includes("not available"));
    assert.equal(v.data, null);
  });
});

describe("provider failure paths (offline scenarios)", () => {
  for (const [scenario, status, reason] of [
    ["stale", "BLOCKED", "stale"],
    ["missing-bar", "BLOCKED", "missing bars"],
    ["outage", "BLOCKED", "unavailable"],
    ["rate-limited", "WAIT", "rate limit"],
  ] as const) {
    it(`${scenario} => ${status}; PROVIDER_FAILURE alert; no decision`, async () => {
      const base = marketDeps();
      const deps = { ...base, market: withScenario(base.market, scenario) };
      const v = await connect(deps, END, "TSLA");
      assert.equal(v.runtime?.status, status);
      assert.ok(v.runtime?.reasons.some((r) => r.toLowerCase().includes(reason)), JSON.stringify(v.runtime));
      assert.equal(v.data, null);
      assert.equal(v.alerts.length, 1);
      assert.doesNotMatch(JSON.stringify(v.runtime), /maxStaleness|normalizeFeed|MISSING_BARS|I:SPX/);
    });
  }
});

describe("runtime persistence, idempotency and restart recovery", () => {
  it("reconnecting the same market state is idempotent", async () => {
    const deps = marketDeps();
    await connect(deps, END, "TSLA");
    const again = await connect(deps, END + MIN, "TSLA");
    assert.equal(again.runtime?.status, "UNCHANGED");
    assert.equal((await deps.store.listRecords(USER_A)).filter((r) => r.evidenceMode === "DATA").length, 1);
    const alerts = (await deps.store.listAlerts(USER_A)).length;
    await connect(deps, END + 2 * MIN, "TSLA");
    assert.equal((await deps.store.listAlerts(USER_A)).length, alerts);
  });
  it("process restart: a new store over the same durable file resumes (previous decision restored)", async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "klynge-store-")), "store.json");
    const first = { ...marketDeps(), store: new FileSessionStore(file) };
    assert.equal((await connect(first, END, "TSLA")).data?.decision, "CALL_SETUP");
    const restarted = { ...marketDeps(), store: new FileSessionStore(file) };
    const v = await connect(restarted, END + 5 * MIN, "TSLA");
    assert.equal(v.runtime?.status, "UNCHANGED");
    assert.equal(v.runtime?.previousRestored, true);
    assert.equal(v.data?.decision, "CALL_SETUP");
    const ws = await getWorkspace(restarted, USER_A, SID);
    assert.equal(ws.data?.decision, "CALL_SETUP");
  });
  it("corrupted durable cursor => BLOCKED (RUNTIME_STATE_UNAVAILABLE), never reconstructed", async () => {
    const deps = marketDeps();
    await connect(deps, END, "TSLA");
    const state = (await deps.store.getRuntimeState(USER_A, `${SID}:TSLA`))!;
    await deps.store.putRuntimeState(USER_A, { ...state, lastRecordId: "missing-record" });
    const v = await connect(deps, END + MIN, "TSLA");
    assert.equal(v.runtime?.status, "BLOCKED");
    assert.match(v.runtime?.title ?? "", /could not be verified/);
  });
});
