import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MOCK_SESSION_COOKIE, MockAuthGateway } from "./auth/mock-auth.ts";
import { IdentityError, LEGACY_TENANT_COOKIE, resolveIdentity, SESSION_COOKIE, TRIAL_COOKIE } from "./identity.ts";
import { MemorySessionStore } from "./store/memory-store.ts";
import { SupabaseSessionStore } from "./store/supabase-store.ts";
import { TrialSessionStore } from "./store/trial-store.ts";
import { APP_ROOT, corpusImage, memoryJar, MIN, T, testDeps, TRIAL_A, trialDeps, USER_A, USER_B } from "./test-support.ts";
import { addJournalNote, connectData, getWorkspace, history, importOhlcv, promoteTrial, uploadChart, WorkspaceError } from "./workspace.ts";
import type { WorkspaceDeps } from "./workspace.ts";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

const ENV = { KLYNGE_TEST_MODE: "1", KLYNGE_AUTH: "mock", KLYNGE_TEST_AUTH_SECRET: "tenancy-secret" };
const SID = "55555555-5555-4555-a555-555555555555";
const TRIAL = "33333333-3333-4333-a333-333333333333";
const fixture = JSON.parse(readFileSync(path.join(APP_ROOT, "test/fixtures/ohlcv-call.json"), "utf8")) as Record<string, unknown>;
const authRequired = (e: unknown) => e instanceof WorkspaceError && e.code === "AUTH_REQUIRED";
const up = (deps: WorkspaceDeps, tenantId: string, id: string, now: number, sessionId = SID) => uploadChart(deps, { tenantId, sessionId, bytes: corpusImage(id), hints: {}, actor: "user", now });

describe("tenant derivation (server-side only)", () => {
  it("verified user => tenantId = auth user id; legacy tenant cookie ignored", async () => {
    const jar = memoryJar({ [SESSION_COOKIE]: SID, [TRIAL_COOKIE]: TRIAL, [LEGACY_TENANT_COOKIE]: USER_B });
    const g = new MockAuthGateway(jar, { env: ENV });
    const user = await g.exchangeCode(g.issueOAuthCode("owner@example.com"));
    const id = await resolveIdentity(g, jar);
    assert.equal(id.kind, "USER");
    assert.equal(id.tenantId, user.id);
    assert.notEqual(id.tenantId, USER_B);
    assert.equal(id.kind === "USER" && id.trialTenantId, `trial:${TRIAL}`);
  });
  it("no verified user => TRIAL identity (never durable); forged session cookie does not become a user", async () => {
    const jar = memoryJar({ [SESSION_COOKIE]: SID, [TRIAL_COOKIE]: TRIAL, [MOCK_SESSION_COOKIE]: JSON.stringify({ sub: USER_A }) });
    const id = await resolveIdentity(new MockAuthGateway(jar, { env: ENV }), jar);
    assert.deepEqual(id, { kind: "TRIAL", tenantId: `trial:${TRIAL}`, sessionId: SID });
  });
  it("malformed cookies are rejected, not used", async () => {
    const g = new MockAuthGateway(memoryJar(), { env: ENV });
    await assert.rejects(resolveIdentity(g, memoryJar({ [SESSION_COOKIE]: "../../etc", [TRIAL_COOKIE]: TRIAL })), IdentityError);
    await assert.rejects(resolveIdentity(g, memoryJar({ [SESSION_COOKIE]: SID, [TRIAL_COOKIE]: "admin" })), IdentityError);
  });
});

describe("anonymous trial: visual only, nothing durable", () => {
  it("anonymous may upload charts and run visual analysis", async () => {
    const deps = trialDeps();
    await up(deps, TRIAL_A, "tsla-5m-bull", T);
    await up(deps, TRIAL_A, "spx-5m-bull", T + MIN);
    const v = await up(deps, TRIAL_A, "mnq-5m-bull", T + 2 * MIN);
    assert.equal(v.visual?.label, "BULLISH CONTEXT");
    assert.equal(v.account.kind, "TRIAL");
    assert.deepEqual(v.alerts, [], "no alerts persisted for a trial");
  });
  it("anonymous may NOT persist decisions, journal, alerts, history or connect data", async () => {
    const deps = trialDeps();
    const v = await up(deps, TRIAL_A, "tsla-5m-bull", T);
    await assert.rejects(importOhlcv(deps, { tenantId: TRIAL_A, sessionId: SID, json: fixture, now: T }), authRequired);
    await assert.rejects(addJournalNote(deps, { tenantId: TRIAL_A, recordId: v.latestRecordId!, note: "x", author: "anon", now: T }), authRequired);
    await assert.rejects(history(deps, TRIAL_A), authRequired);
    await assert.rejects(connectData(deps, { tenantId: TRIAL_A, sessionId: SID, now: T }), authRequired);
    const store = deps.store as TrialSessionStore;
    assert.equal(await store.addAlert(TRIAL_A, { alertId: "x" } as never), false);
    assert.equal(await store.addJournal({} as never), false);
    await assert.rejects(store.putRuntimeState(TRIAL_A, {} as never), /cannot persist runtime state/);
    await assert.rejects(store.putRecord({ recordId: "d", tenantId: TRIAL_A, sessionId: SID, symbol: "TSLA", timeframe: "5m", evidenceMode: "DATA", at: T }), /cannot hold DATA/);
    await assert.rejects(store.putSession({ sessionId: SID, tenantId: USER_A, createdAt: T, charts: [] }), /only holds anonymous trial/);
  });
  it("trial state is short-lived (TTL) and bounded", async () => {
    let now = T;
    const store = new TrialSessionStore({ clock: () => now, ttlMs: 60 * MIN, maxSessions: 2 });
    for (const [i, t] of ["a", "b", "c"].entries()) await store.putSession({ sessionId: SID, tenantId: `trial:${t}`, createdAt: T + i, charts: [] });
    assert.equal(store.size, 2, "oldest evicted beyond the cap");
    now += 61 * MIN;
    assert.equal(store.sweep(), 2);
    assert.equal(await store.getSession("trial:c", SID), undefined);
  });
});

describe("anonymous promotion (explicit copy, provenance preserved)", () => {
  it("copies the trial into a NEW durable session owned by the verified user; the trial is never mutated", async () => {
    const trial = trialDeps();
    await up(trial, TRIAL_A, "tsla-5m-bull", T);
    await up(trial, TRIAL_A, "spx-5m-bull", T + MIN);
    await up(trial, TRIAL_A, "mnq-5m-bull", T + 2 * MIN);
    const before = JSON.stringify(await trial.store.getSession(TRIAL_A, SID));
    const user = testDeps();
    const NEW = "66666666-6666-4666-a666-666666666666";
    const v = await promoteTrial(trial.store, user, { trialTenantId: TRIAL_A, trialSessionId: SID, userId: USER_A, newSessionId: NEW, now: T + 3 * MIN });
    assert.equal(v.sessionId, NEW);
    assert.equal(v.charts.length, 3);
    assert.equal(v.account.origin, "ANONYMOUS_TRIAL");
    const saved = await user.store.getSession(USER_A, NEW);
    assert.deepEqual([saved?.tenantId, saved?.origin, saved?.promotedAt], [USER_A, "ANONYMOUS_TRIAL", T + 3 * MIN]);
    assert.ok(saved?.charts.every((c) => c.audit !== undefined), "audit trail preserved");
    assert.equal(JSON.stringify(await trial.store.getSession(TRIAL_A, SID)), before, "trial untouched");
    const records = await user.store.listRecords(USER_A);
    assert.ok(records.length === 1 && records[0]!.origin === "ANONYMOUS_TRIAL");
    assert.deepEqual((await history(user, USER_A)).map((r) => r.origin), ["ANONYMOUS_TRIAL"]);
    assert.equal((await user.store.listRecords(TRIAL_A)).length, 0, "nothing durable keyed by the trial id");
  });
  it("requires a durable target, a trial source and charts", async () => {
    const trial = trialDeps();
    await assert.rejects(promoteTrial(trial.store, trial, { trialTenantId: TRIAL_A, trialSessionId: SID, userId: USER_A, newSessionId: SID, now: T }), authRequired);
    await assert.rejects(promoteTrial(new MemorySessionStore(), testDeps(), { trialTenantId: TRIAL_A, trialSessionId: SID, userId: USER_A, newSessionId: SID, now: T }), /Only trial sessions/);
    await assert.rejects(promoteTrial(trial.store, testDeps(), { trialTenantId: TRIAL_A, trialSessionId: SID, userId: USER_A, newSessionId: SID, now: T }), (e: unknown) => e instanceof WorkspaceError && e.code === "NOT_FOUND");
  });
});

describe("durable ownership", () => {
  it("authenticated work persists under the verified user id; other users see nothing", async () => {
    const deps = testDeps();
    await up(deps, USER_A, "tsla-5m-bull", T);
    const data = await importOhlcv(deps, { tenantId: USER_A, sessionId: SID, json: fixture, now: T });
    await addJournalNote(deps, { tenantId: USER_A, recordId: data.latestRecordId!, note: "mine", author: "a", now: T });
    assert.equal((await history(deps, USER_A)).length, 2);
    assert.equal((await history(deps, USER_B)).length, 0);
    const b = await getWorkspace(deps, USER_B, SID);
    assert.deepEqual([b.charts.length, b.data, b.journal.length, b.alerts.length], [0, null, 0, 0]);
    await assert.rejects(addJournalNote(deps, { tenantId: USER_B, recordId: data.latestRecordId!, note: "theirs", author: "b", now: T }), (e: unknown) => e instanceof WorkspaceError && e.code === "NOT_FOUND");
  });
  it("Supabase store is bound to one verified user and refuses other tenants before any query", async () => {
    let queried = false;
    const db = new Proxy({}, { get: () => () => ((queried = true), {}) }) as unknown as SupabaseClient;
    const store = new SupabaseSessionStore(db, USER_A);
    await assert.rejects(store.putRecord({ recordId: "r", tenantId: USER_B, sessionId: SID, symbol: "TSLA", timeframe: null, evidenceMode: "VISUAL", at: T }), /tenant mismatch/);
    await assert.rejects(store.listRecords(USER_B), /tenant mismatch/);
    await assert.rejects(store.getRuntimeState(USER_B, "rt"), /tenant mismatch/);
    assert.equal(queried, false);
  });
});
