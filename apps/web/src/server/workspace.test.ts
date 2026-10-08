import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { END, trendFeed } from "../../../../src/klynge/mtf-test-fixtures.ts";
import { VISUAL_VERIFICATION_NOTICE } from "./engine-core.ts";
import type { ExtractionHints } from "./extraction/types.ts";
import { APP_ROOT, corpusImage, MIN, T, testDeps, unknownChart } from "./test-support.ts";
import { addJournalNote, confirmField, getWorkspace, history, importOhlcv, uploadChart, WorkspaceError } from "./workspace.ts";
import type { WorkspaceDeps } from "./workspace.ts";

const TENANT = "tenant-a";
const SESSION = "session-1";
const up = (deps: WorkspaceDeps, image: string | Buffer, now: number, hints: ExtractionHints = {}) =>
  uploadChart(deps, { tenantId: TENANT, sessionId: SESSION, bytes: typeof image === "string" ? corpusImage(image) : image, hints, actor: "user", now });
const fullSet = async (deps: WorkspaceDeps, target = "tsla-5m-bull") => {
  await up(deps, target, T);
  await up(deps, "spx-5m-bull", T + MIN);
  return up(deps, "mnq-5m-bull", T + 2 * MIN);
};
const fixture = JSON.parse(readFileSync(path.join(APP_ROOT, "test/fixtures/ohlcv-call.json"), "utf8")) as Record<string, unknown>;
const field = (view: Awaited<ReturnType<typeof up>>, symbol: string, f: string) => view.charts.find((c) => c.symbol === symbol)?.fields.find((x) => x.field === f);
const NO_DIRECTIONAL = /CALL_SETUP|PUT_SETUP|ELIGIBLE|CONDITIONS MET/;

describe("visual workflow (chart → extraction → validation → session → visual context)", () => {
  it("target alone => INSUFFICIENT CONTEXT / WAIT with next steps", async () => {
    const v = await up(testDeps(), "tsla-5m-bull", T);
    assert.equal(v.visual?.label, "INSUFFICIENT CONTEXT");
    assert.equal(v.visual?.permission, "WAIT");
    assert.ok(v.visual?.reasons.includes("Broad-market confirmation has not been provided"));
    assert.ok(v.visual?.nextSteps.includes("+ Add SPX chart"));
    assert.ok(v.visual?.nextSteps.includes("+ Add MNQ chart"));
    assert.deepEqual(v.completeness.map((c) => [c.role, c.present]), [["TARGET", true], ["SPX", false], ["MNQ", false]]);
  });

  it("TSLA + SPX + MNQ bullish => BULLISH CONTEXT / WAIT, never a setup", async () => {
    const v = await fullSet(testDeps());
    assert.equal(v.visual?.label, "BULLISH CONTEXT");
    assert.equal(v.visual?.permission, "WAIT");
    assert.equal(v.visual?.notice, VISUAL_VERIFICATION_NOTICE);
    assert.equal(v.visual?.notice, "Conditions observed — data verification required");
    assert.ok(v.visual?.notVerified.some((s) => /ATR/.test(s)));
    assert.equal(v.data, null);
    assert.doesNotMatch(JSON.stringify(v), NO_DIRECTIONAL);
  });

  it("confident extractor error (bearish target misread as MIXED) never yields BULLISH", async () => {
    const deps = testDeps();
    await up(deps, "tsla-5m-bear", T);
    await up(deps, "spx-5m-bull", T + MIN);
    const v = await up(deps, "mnq-5m-bull", T + 2 * MIN);
    // tsla-5m-bear's recorded structure is a confident error (MIXED) that passes validation, so the target reads MIXED.
    assert.equal(v.visual?.permission, "WAIT");
    assert.notEqual(v.visual?.label, "BULLISH CONTEXT");
  });

  it("low-confidence observation => NOT_VERIFIED, context stays INSUFFICIENT until confirmed", async () => {
    const deps = testDeps();
    await up(deps, "nvda-5m-ambiguous", T);
    await up(deps, "spx-5m-bull", T + MIN);
    const v = await up(deps, "mnq-5m-bull", T + 2 * MIN);
    assert.equal(field(v, "NVDA", "structure")?.status, "NOT_VERIFIED");
    assert.equal(v.visual?.label, "INSUFFICIENT CONTEXT");
    assert.ok(v.visual?.nextSteps.some((s) => /structure/i.test(s)));
  });

  it("confirmation => USER_CONFIRMED with audit, then re-evaluated (never DATA_VERIFIED)", async () => {
    const deps = testDeps();
    await up(deps, "nvda-5m-ambiguous", T);
    await up(deps, "spx-5m-bull", T + MIN);
    const before = await up(deps, "mnq-5m-bull", T + 2 * MIN);
    const nvda = before.charts.find((c) => c.symbol === "NVDA")!;
    const v = await confirmField(deps, { tenantId: TENANT, sessionId: SESSION, chartId: nvda.chartId, edit: { field: "structure", action: "EDIT", value: "MIXED" }, actor: "user", now: T + 3 * MIN });
    const f = field(v, "NVDA", "structure");
    assert.equal(f?.status, "USER_CONFIRMED");
    assert.equal(v.charts.find((c) => c.symbol === "NVDA")?.confirmations, 1);
    assert.doesNotMatch(JSON.stringify(v), /DATA_VERIFIED/);
    assert.notEqual(v.visual?.label, "INSUFFICIENT CONTEXT");
    await assert.rejects(
      confirmField(deps, { tenantId: TENANT, sessionId: SESSION, chartId: nvda.chartId, edit: { field: "structure", action: "EDIT", value: "SIDEWAYS" }, actor: "user", now: T + 4 * MIN }),
      (e: unknown) => e instanceof WorkspaceError && e.code === "INVALID",
    );
    await assert.rejects(
      confirmField(deps, { tenantId: TENANT, sessionId: "missing", chartId: nvda.chartId, edit: { field: "structure", action: "CONFIRM" }, actor: "user", now: T }),
      (e: unknown) => e instanceof WorkspaceError && e.code === "NOT_FOUND",
    );
  });

  it("chart set captured too far apart => BLOCKED (TIMESTAMP_SKEW)", async () => {
    const deps = testDeps();
    await up(deps, "tsla-5m-bull", T);
    await up(deps, "spx-5m-bull", T + MIN);
    const v = await up(deps, "mnq-5m-bull", T + 10 * MIN);
    assert.equal(v.visual?.permission, "BLOCKED");
    assert.ok(v.visual?.blockers.includes("TIMESTAMP_SKEW"));
  });

  it("re-evaluated long after capture => BLOCKED (STALE_DATA)", async () => {
    const deps = testDeps();
    const v0 = await fullSet(deps);
    const tsla = v0.charts.find((c) => c.symbol === "TSLA")!;
    const v = await confirmField(deps, { tenantId: TENANT, sessionId: SESSION, chartId: tsla.chartId, edit: { field: "symbol", action: "CONFIRM" }, actor: "user", now: T + 30 * MIN });
    assert.equal(v.visual?.permission, "BLOCKED");
    assert.ok(v.visual?.blockers.includes("STALE_DATA"));
  });

  it("role override that contradicts the chart => role violation, BLOCKED", async () => {
    const deps = testDeps();
    await up(deps, "tsla-5m-bull", T);
    await up(deps, "spx-5m-bull", T + MIN);
    const v = await up(deps, "nvda-5m-ambiguous", T + 2 * MIN, { role: "MNQ" });
    const nvda = v.charts.find((c) => c.symbol === "NVDA");
    assert.equal(nvda?.role, "MNQ");
    assert.match(nvda?.roleViolation ?? "", /NVDA cannot fill the MNQ role/);
    assert.equal(v.visual?.permission, "BLOCKED");
    assert.ok(v.visual?.blockers.includes("ROLE_VIOLATION"));
  });

  it("hints: conflict => NOT_VERIFIED; absent field => audited user confirmation", async () => {
    const deps = testDeps();
    const conflict = await up(deps, "tsla-5m-bull", T, { symbol: "NVDA" });
    const sym = conflict.charts[0]!.fields.find((f) => f.field === "symbol");
    assert.equal(sym?.status, "NOT_VERIFIED");
    assert.ok(conflict.charts[0]!.issues.some((i) => /conflicts with the chart/.test(i)));

    const filled = await uploadChart(testDeps(), { tenantId: TENANT, sessionId: SESSION, bytes: await unknownChart(), hints: { symbol: "TSLA", timeframe: "5m" }, actor: "user", now: T });
    const c = filled.charts[0]!;
    assert.equal(c.fields.find((f) => f.field === "symbol")?.status, "USER_CONFIRMED");
    assert.equal(c.fields.find((f) => f.field === "timeframe")?.status, "USER_CONFIRMED");
    assert.equal(c.fields.find((f) => f.field === "structure")?.status, "NOT_PROVIDED");
    assert.equal(c.confirmations, 2);
    assert.ok(c.issues.some((i) => /no recording/.test(i)));
    assert.equal(filled.visual?.label, "INSUFFICIENT CONTEXT");
  });

  it("injected unsupported fields (ATR) are dropped and reported", async () => {
    const v = await up(testDeps(), "spx-5m-bear", T);
    assert.ok(v.charts[0]!.issues.some((i) => /atr14/.test(i)));
    assert.doesNotMatch(JSON.stringify(v.charts[0]!.fields), /atr14/);
  });

  it("tenants are isolated", async () => {
    const deps = testDeps();
    await fullSet(deps);
    const other = await getWorkspace(deps, "tenant-b", SESSION);
    assert.deepEqual([other.charts.length, other.visual, other.alerts.length], [0, null, 0]);
  });
});

describe("DATA workflow (OHLCV → DATA snapshot → existing pipeline)", () => {
  it("fixture => CALL_SETUP with risk, ATTENTION alert", async () => {
    const deps = testDeps();
    const v = await importOhlcv(deps, { tenantId: TENANT, sessionId: SESSION, json: fixture, now: T });
    assert.equal(v.data?.decision, "CALL_SETUP");
    assert.equal(v.data?.evidenceMode, "DATA");
    assert.equal(v.data?.risk?.allowed, true);
    assert.deepEqual(v.alerts.map((a) => a.severity), ["ATTENTION"]);
  });

  it("later mixed-market import chains the persisted decision => INVALIDATED + WARNING", async () => {
    const deps = testDeps();
    await importOhlcv(deps, { tenantId: TENANT, sessionId: SESSION, json: fixture, now: T });
    const mixed = { ...fixture, asOf: END + 1000, mnq: trendFeed("MNQ", -0.05, 18000) };
    const v = await importOhlcv(deps, { tenantId: TENANT, sessionId: SESSION, json: mixed, now: T + MIN });
    assert.equal(v.data?.decision, "INVALIDATED");
    assert.deepEqual(v.alerts.map((a) => a.severity), ["WARNING", "ATTENTION"]);
    // Without a persisted previous decision the same input is merely BLOCKED.
    const fresh = await importOhlcv(testDeps(), { tenantId: TENANT, sessionId: SESSION, json: mixed, now: T });
    assert.equal(fresh.data?.decision, "BLOCKED");
  });

  it("re-import is idempotent (same record, no duplicate alerts)", async () => {
    const deps = testDeps();
    await importOhlcv(deps, { tenantId: TENANT, sessionId: SESSION, json: fixture, now: T });
    await importOhlcv(deps, { tenantId: TENANT, sessionId: SESSION, json: fixture, now: T + MIN });
    assert.equal((await deps.store.listRecords(TENANT)).length, 1);
    assert.equal((await deps.store.listAlerts(TENANT)).length, 1);
  });

  it("malformed OHLCV => INVALID; bad candles fail closed in the engine", async () => {
    await assert.rejects(importOhlcv(testDeps(), { tenantId: TENANT, sessionId: SESSION, json: { target: [] }, now: T }), (e: unknown) => e instanceof WorkspaceError && e.code === "INVALID");
    await assert.rejects(importOhlcv(testDeps(), { tenantId: TENANT, sessionId: SESSION, json: { ...fixture, spx: [] }, now: T }), /non-empty/);
    const spx = structuredClone(fixture.spx) as { candles: { high: number; low: number }[] }[];
    const bar = spx.at(-1)!.candles.at(-1)!;
    bar.high = bar.low - 1;
    const v = await importOhlcv(testDeps(), { tenantId: TENANT, sessionId: SESSION, json: { ...fixture, spx }, now: T });
    assert.equal(v.data?.decision, "BLOCKED");
  });

  it("visual and data records coexist; history shows both modes with honest permissions", async () => {
    const deps = testDeps();
    await fullSet(deps);
    await importOhlcv(deps, { tenantId: TENANT, sessionId: SESSION, json: fixture, now: T });
    const rows = await history(deps, TENANT);
    const visual = rows.filter((r) => r.evidenceMode === "VISUAL");
    const data = rows.filter((r) => r.evidenceMode === "DATA");
    assert.ok(visual.length >= 3 && data.length === 1);
    assert.ok(visual.every((r) => r.permission === "WAIT" || r.permission === "BLOCKED"));
    assert.ok(visual.every((r) => !NO_DIRECTIONAL.test(r.state)));
    assert.deepEqual([data[0]!.state, data[0]!.permission], ["CALL_SETUP", "CONDITIONS MET"]);
    assert.ok((await history(deps, TENANT, "NVDA")).length === 0);
  });
});

describe("journal (annotations never mutate engine records)", () => {
  it("notes attach to a record; record is unchanged; idempotent; validated", async () => {
    const deps = testDeps();
    const v = await importOhlcv(deps, { tenantId: TENANT, sessionId: SESSION, json: fixture, now: T });
    const recordId = v.latestRecordId!;
    const before = JSON.stringify(await deps.store.listRecords(TENANT));
    const note = { tenantId: TENANT, recordId, note: "  Waited for the retest.  ", author: "user", now: T + MIN };
    await addJournalNote(deps, note);
    await addJournalNote(deps, note);
    assert.equal(JSON.stringify(await deps.store.listRecords(TENANT)), before);
    const ws = await getWorkspace(deps, TENANT, SESSION);
    assert.deepEqual(ws.journal.map((j) => j.note), ["Waited for the retest."]);
    assert.equal((await history(deps, TENANT))[0]!.notes, 1);
    await assert.rejects(addJournalNote(deps, { ...note, note: "   " }), (e: unknown) => e instanceof WorkspaceError && e.code === "INVALID");
    await assert.rejects(addJournalNote(deps, { ...note, recordId: "nope" }), (e: unknown) => e instanceof WorkspaceError && e.code === "NOT_FOUND");
    await assert.rejects(addJournalNote(deps, { ...note, tenantId: "tenant-b" }), (e: unknown) => e instanceof WorkspaceError && e.code === "NOT_FOUND");
  });
});
