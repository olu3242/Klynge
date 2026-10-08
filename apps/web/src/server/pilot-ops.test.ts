import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { MemoryAccountStore } from "./account/memory-account-store.ts";
import type { OutboxItem } from "./account/types.ts";
import { DELETE_CONFIRMATION, deleteAccount, exportAccount } from "./account/privacy.ts";
import { pilotGateVerdict } from "./pilot/access.ts";
import { adminAction, AdminActionError, adminView, tenantRef } from "./pilot/admin.ts";
import { pilotAnalytics } from "./pilot/analytics.ts";
import { evidenceClass, evidenceEntry, evidenceLedger } from "./pilot/evidence.ts";
import { MemoryPilotStore } from "./pilot/memory-pilot-store.ts";
import { activatePilot, submitFeedback } from "./pilot/pilot.ts";
import { pilotStateOf } from "./pilot/types.ts";
import { opsReport } from "./ops/ops-report.ts";
import { actualState, loadManifest, policyFingerprint, releaseReadiness } from "./release/manifest.ts";
import type { ReleaseManifest } from "./release/manifest.ts";
import type { MemorySessionStore } from "./store/memory-store.ts";
import type { DecisionRecord } from "./store/types.ts";
import { APP_ROOT, corpusImage, MIN, T, testDeps, USER_A, USER_B } from "./test-support.ts";
import { uploadChart } from "./workspace.ts";

const prov = (provider: string) => ({ provider, providerSymbol: "I:SPX", canonicalSymbol: "SPX", role: "SPX", timeframe: "5m", fetchedAt: T, latestMarketTimestamp: T - MIN, evidenceMode: "DATA", normalized: true, bars: 78, sessions: 2, warnings: [] });
const dataRec = (recordId: string, providers: string[] | null, decision = "WAIT"): DecisionRecord =>
  ({ recordId, tenantId: USER_A, sessionId: "s", symbol: "TSLA", timeframe: "5m", evidenceMode: "DATA", at: T, marketTimestamp: T - MIN, marketData: providers?.map(prov), data: { decision, regime: "RISK_ON", blockers: decision === "BLOCKED" ? ["PROVIDER_STALE"] : [], risk: { entryZone: { low: 101.11, high: 102.22 }, invalidation: 99.99, target: 107.77 }, provenance: { engineVersion: "0.8.0", ruleVersion: "pilot-operations-v1", evaluatedAt: T } } }) as unknown as DecisionRecord;
const visualRec = (recordId: string): DecisionRecord => ({ recordId, tenantId: USER_A, sessionId: "s", symbol: "TSLA", timeframe: "5m", evidenceMode: "VISUAL", at: T, visual: { permission: "WAIT", regime: "RISK_ON" } }) as unknown as DecisionRecord;

describe("real-market evidence ledger (Batch 73)", () => {
  it("keeps evidence classes apart; only vendor DATA is verified; screenshots never yield a setup or OHLCV", () => {
    assert.equal(evidenceClass(visualRec("v")), "USER_SCREENSHOT");
    assert.equal(evidenceClass(dataRec("m", ["mock"])), "SYNTHETIC_FIXTURE");
    assert.equal(evidenceClass(dataRec("p", ["polygon", "cme-futures"])), "VERIFIED_LIVE");
    assert.equal(evidenceClass(dataRec("i", null)), "USER_IMPORTED_DATA");
    const v = evidenceEntry(visualRec("v"));
    assert.deepEqual([v.verified, v.outcome, v.dataQuality.outcome], [false, "WAIT", "NOT_APPLICABLE"]);
    assert.deepEqual([evidenceEntry(dataRec("i", null, "CALL_SETUP")).verified, evidenceEntry(dataRec("m", ["mock"])).verified], [false, false]);
  });
  it("records decisions exactly, never prices; licensing flags are explicit; the projection never mutates records", () => {
    const recs = [dataRec("b", ["polygon"], "BLOCKED"), dataRec("a", ["polygon"], "CALL_SETUP"), visualRec("c")];
    const before = JSON.stringify(recs);
    const ledger = evidenceLedger(recs);
    assert.deepEqual(ledger.map((e) => [e.recordId, e.outcome]), [["a", "CALL_SETUP"], ["b", "BLOCKED"], ["c", "WAIT"]]);
    assert.deepEqual(ledger[1]!.dataQuality.blockers, ["PROVIDER_STALE"]);
    const json = JSON.stringify(ledger);
    for (const leak of ["101.11", "102.22", "99.99", "107.77", "entryZone", "invalidation"]) assert.ok(!json.includes(leak), leak);
    assert.ok(ledger.every((e) => e.licensing.pricesIncluded === false && e.licensing.redistribution === false && e.ledgerVersion === "evidence-ledger-v1"));
    assert.equal(JSON.stringify(recs), before);
    assert.deepEqual(evidenceLedger(recs).map((e) => e.evidenceId), ledger.map((e) => e.evidenceId), "deterministic ids");
  });
});

describe("pilot analytics (Batch 75)", () => {
  const out = (status: OutboxItem["status"]) => ({ status }) as OutboxItem;
  const fb = (usefulness: number) => ({ feedbackId: `f${usefulness}`, tenantId: USER_A, sessionId: "s", recordId: null, at: T, kind: "USER_REPORTED" as const, ratings: { clarity: 5 as const, confidence: null, usability: null, usefulness: usefulness as 5 }, missingInformation: null, problem: { category: "ALERTS" as const, description: "x" } });
  it("reports WAIT/BLOCKED frequency, setups by ticker/timeframe/regime, quality, corrections, alerts, sessions; satisfaction ≠ accuracy", () => {
    const a = pilotAnalytics({ now: T + 2 * 86_400_000, records: [dataRec("1", ["polygon"], "WAIT"), dataRec("2", ["polygon"], "BLOCKED"), dataRec("3", ["polygon"], "CALL_SETUP"), visualRec("4")], sessions: [], alerts: [{ event: "PROVIDER_FAILURE", at: T }], outbox: [out("DELIVERED"), out("FAILED")], feedback: [fb(5), fb(4)], onboarding: [], enrollments: [], hypothetical: { evidence: "SYNTHETIC_NOT_EMPIRICAL", trades: 3, holdoutInsufficient: true } });
    assert.equal(a.decisions.waitOrBlockedRate, 0.667);
    assert.deepEqual(a.setups.byTicker, { TSLA: 1 });
    assert.deepEqual(a.dataQuality.blockedByCode, { PROVIDER_STALE: 1 });
    assert.equal(a.alerts.alertProblemReports, 2);
    assert.equal(a.satisfaction.usefulness, 4.5);
    assert.equal(a.accuracy.status, "NOT_MEASURED_BY_FEEDBACK");
    assert.equal(a.hypotheticalOutcomes.status, "NOT_AVAILABLE", "synthetic outcomes are never reported as evidence");
    assert.equal(a.performanceClaim, "NONE");
    assert.equal(pilotAnalytics({ now: T, records: [], sessions: [], alerts: [], outbox: [], feedback: [], onboarding: [], enrollments: [], hypothetical: { evidence: "EMPIRICAL_HISTORICAL", trades: 40, holdoutInsufficient: false } }).hypotheticalOutcomes.status, "AVAILABLE");
  });
  it("counts corrections, complete chart sets and abandonment from real sessions", async () => {
    const d = testDeps();
    for (const [img, dt] of [["tsla-5m-bull", 0], ["spx-5m-bull", 1], ["mnq-5m-bull", 2]] as const) await uploadChart(d, { tenantId: USER_A, sessionId: "s1", bytes: corpusImage(img), hints: {}, actor: "u", now: T + dt * MIN });
    await uploadChart(d, { tenantId: USER_B, sessionId: "s2", bytes: corpusImage("tsla-5m-bull"), hints: {}, actor: "u", now: T });
    const snap = (d.store as MemorySessionStore).infrastructureSnapshot();
    const a = pilotAnalytics({ now: T + 2 * 86_400_000, records: snap.records, sessions: snap.sessions, alerts: [], outbox: [], feedback: [], onboarding: [], enrollments: [] });
    assert.deepEqual([a.sessions.started, a.sessions.completeChartSet, a.sessions.abandoned], [2, 1, 1]);
    assert.equal(a.evidence.USER_SCREENSHOT, a.decisions.visualAnalyses);
  });
});

describe("pilot control plane (Batch 78)", () => {
  const setup = async () => {
    const pilot = new MemoryPilotStore();
    const account = new MemoryAccountStore();
    const d = { ...testDeps(), pilot, account };
    return { d, s: { pilot, account, durable: d.store as MemorySessionStore } };
  };
  it("invite → activate → suspend → access denied → reinstate; every action audited with hashed operator refs", async () => {
    const { d, s } = await setup();
    await adminAction(s, "operator-uuid", { action: "invite", email: "Pia@Example.com" }, T);
    await activatePilot(d, { tenantId: USER_A, email: "pia@example.com", riskAcknowledged: true, consent: true, now: T + 1 });
    const ref = tenantRef(USER_A);
    await adminAction(s, "operator-uuid", { action: "set-status", tenantRef: ref, status: "SUSPENDED", reason: "review" }, T + 2);
    const state = pilotStateOf(await d.pilot.getInvite("pia@example.com"), await d.pilot.getEnrollment(USER_A));
    assert.equal(pilotGateVerdict("invite-only", "USER", state, false), "SUSPENDED");
    await adminAction(s, "operator-uuid", { action: "set-status", tenantRef: ref, status: "ACTIVE" }, T + 3);
    assert.equal((await d.pilot.getEnrollment(USER_A))?.status, "ACTIVE");
    const audit = s.pilot.allOpsAudit();
    assert.deepEqual(audit.map((a) => a.action).sort(), ["pilot.invited", "pilot.reinstated", "pilot.suspended"]);
    assert.ok(audit.every((a) => /^op_[0-9a-f]{12}$/.test(a.operator)));
    assert.ok(!JSON.stringify(audit).includes("pia@") && !JSON.stringify(audit).includes(USER_A));
  });
  it("triage separates user reports from verified defects; bad input is refused", async () => {
    const { d, s } = await setup();
    const f = await submitFeedback(d, { tenantId: USER_A, sessionId: "s", body: { problem: { category: "DATA", description: "stale SPX" } }, now: T });
    const ref = tenantRef(USER_A);
    await assert.rejects(adminAction(s, "op", { action: "triage", tenantRef: ref, feedbackId: f.feedbackId, status: "DEFECT_CONFIRMED" }, T), AdminActionError);
    await adminAction(s, "op", { action: "triage", tenantRef: ref, feedbackId: f.feedbackId, status: "DEFECT_CONFIRMED", defectRef: "KLY-12" }, T + 1);
    const view = adminView(s, opsReport({ now: T, storeMode: "memory", scope: "IN_PROCESS", market: null, records: [], runtime: [], alerts: [], outbox: [], audit: [], workerRuns: [], datasets: null }), pilotAnalytics({ now: T, records: [], sessions: [], alerts: [], outbox: [], feedback: [], onboarding: [], enrollments: [] }));
    assert.equal(view.feedback[0]!.kind, "USER_REPORTED", "the report itself stays user-reported");
    assert.deepEqual([view.feedback[0]!.triage?.status, view.feedback[0]!.triage?.defectRef], ["DEFECT_CONFIRMED", "KLY-12"]);
    assert.ok(!JSON.stringify(view).includes(USER_A), "no raw user ids in the operator view");
    await assert.rejects(adminAction(s, "op", { action: "set-status", tenantRef: "usr_000000000000", status: "SUSPENDED" }, T), /Unknown user/);
    await assert.rejects(adminAction(s, "op", { action: "invite", email: "not-an-email" }, T), /valid email/);
  });
  it("admin actions never touch decisions; dead letters can be requeued", async () => {
    const { d, s } = await setup();
    await uploadChart(d, { tenantId: USER_A, sessionId: "s", bytes: corpusImage("tsla-5m-bull"), hints: {}, actor: "u", now: T });
    const before = JSON.stringify(s.durable.infrastructureSnapshot().records);
    await s.account.enqueue({ notificationId: "n-dead-0001", tenantId: USER_A, alertId: "a", channel: "email", event: "CALL_SETUP", symbol: "TSLA", subject: "s", text: "t", to: "x@example.com", status: "FAILED", attempts: 5, nextAttemptAt: T, createdAt: T, deliveredAt: null, lastError: "down" });
    await adminAction(s, "op", { action: "requeue", notificationId: "n-dead-0001" }, T + 1);
    assert.deepEqual([s.account.allOutbox()[0]!.status, s.account.allOutbox()[0]!.attempts], ["PENDING", 0]);
    await assert.rejects(adminAction(s, "op", { action: "requeue", notificationId: "n-dead-0001" }, T + 2), /No dead-lettered/);
    assert.equal(JSON.stringify(s.durable.infrastructureSnapshot().records), before);
  });
  it("pilot code never reaches policy-change machinery (feedback cannot change production policy)", () => {
    const dir = path.join(APP_ROOT, "src/server/pilot");
    for (const f of readdirSync(dir)) {
      const src = readFileSync(path.join(dir, f), "utf8");
      assert.doesNotMatch(src, /proposePolicyChange|approvePolicyChange|DEFAULT_[A-Z_]*POLICY|putPolicy|putRecord|putRuntimeState/, f);
    }
  });
});

describe("account-data privacy controls (Batch 77)", () => {
  it("export returns only the caller's rows (no images, no message bodies); deletion needs a typed confirmation and spares other users", async () => {
    const pilot = new MemoryPilotStore();
    const account = new MemoryAccountStore();
    const d = { ...testDeps(), pilot, account };
    for (const u of [USER_A, USER_B]) await uploadChart(d, { tenantId: u, sessionId: `s-${u}`, bytes: corpusImage("tsla-5m-bull"), hints: {}, actor: "u", now: T });
    await submitFeedback(d, { tenantId: USER_B, sessionId: "x", body: { ratings: { clarity: 2 } }, now: T });
    const ex = await exportAccount(d, USER_A, "ada@example.com", T + 1);
    const json = JSON.stringify(ex);
    assert.ok(!json.includes(USER_B), "no other tenant");
    assert.ok(!/iVBORw0KGgo|data:image/.test(json), "no images");
    assert.equal(ex.decisions.length, (await d.store.listRecords(USER_A)).length);
    assert.ok((await account.listAudit(USER_A)).some((a) => a.action === "account.exported"));
    const stores = { durable: d.store as MemorySessionStore, account, pilot, images: d.images };
    assert.throws(() => deleteAccount(stores, USER_A, "delete"), /DELETE MY DATA/);
    assert.ok(deleteAccount(stores, USER_A, DELETE_CONFIRMATION).deleted > 0);
    assert.equal((await d.store.listRecords(USER_A)).length, 0);
    assert.equal((await account.listAudit(USER_A)).length, 0);
    assert.equal(d.images.has(USER_A, `s-${USER_A}`, "x"), false);
    assert.ok((await d.store.listRecords(USER_B)).length > 0, "other users untouched");
    assert.equal((await pilot.listFeedback(USER_B)).length, 1);
    assert.throws(() => deleteAccount({ ...stores, durable: null }, USER_A, DELETE_CONFIRMATION), /pilot team/);
  });
});

describe("release governance (Batch 79)", () => {
  const actual = actualState(APP_ROOT);
  const dir = path.resolve(APP_ROOT, "../../releases");
  const m = loadManifest(dir, actual.engineVersion)!;
  const prev = loadManifest(dir, m.previousRelease!)!;
  const human = [{ role: "ENGINEERING" as const, name: "Grace Hopper", at: "2026-10-08" }, { role: "OPERATIONS" as const, name: "Ada Lovelace", at: "2026-10-08" }];
  it("the committed manifest matches the code and is awaiting human approval (never self-approved)", () => {
    const r = releaseReadiness(m, prev, actual);
    assert.equal(r.verdict, "READY_FOR_APPROVAL", JSON.stringify(r.checks.filter((c) => !c.ok)));
    assert.deepEqual(r.pendingMigrations, ["0004_klynge_pilot.sql"]);
    assert.equal(m.approvals.length, 0);
    assert.equal(m.authorizations.deployment.approved, false);
    assert.equal(m.policyFingerprint, policyFingerprint());
    assert.equal(prev.policyFingerprint, m.policyFingerprint, "0.8.0 changes no deterministic policy default");
  });
  it("tampered schema or policy blocks the release; a policy change needs a named human, RISK_POLICY sign-off and a new rule version", () => {
    assert.equal(releaseReadiness(m, prev, { ...actual, policyFingerprint: "0".repeat(64) }).verdict, "BLOCKED");
    assert.equal(releaseReadiness(m, prev, { ...actual, migrations: actual.migrations.map((x, i) => (i === 0 ? { ...x, sha256: "f".repeat(64) } : x)) }).verdict, "BLOCKED");
    const changed: ReleaseManifest = { ...m, policyFingerprint: "a".repeat(64) };
    const act = { ...actual, policyFingerprint: "a".repeat(64) };
    assert.equal(releaseReadiness(changed, prev, act).verdict, "BLOCKED", "no proposal");
    const bot = { ...changed, policyChange: { proposalId: "p1", approvedBy: "calibration-bot", approvedAt: "x", newRuleVersion: m.ruleVersion }, approvals: [{ role: "RISK_POLICY" as const, name: "claude-agent", at: "x" }] };
    assert.equal(releaseReadiness(bot, prev, act).verdict, "BLOCKED", "bots cannot approve");
    const ok = { ...changed, policyChange: { proposalId: "p1", approvedBy: "Ada Lovelace", approvedAt: "x", newRuleVersion: m.ruleVersion }, approvals: [{ role: "RISK_POLICY" as const, name: "Ada Lovelace", at: "x" }] };
    assert.equal(releaseReadiness(ok, prev, act).verdict, "READY_FOR_APPROVAL");
  });
  it("deployment and migrations are authorized separately", () => {
    const deployOnly: ReleaseManifest = { ...m, approvals: human, authorizations: { deployment: { approved: true, by: "Ada Lovelace", at: "x" }, migrations: [] } };
    assert.equal(releaseReadiness(deployOnly, prev, actual).verdict, "READY_FOR_APPROVAL", "an unauthorized migration holds the deployment");
    const both: ReleaseManifest = { ...deployOnly, authorizations: { ...deployOnly.authorizations, migrations: [{ file: "0004_klynge_pilot.sql", project: "example-ref", approvedBy: "Ada Lovelace", at: "x" }] } };
    assert.equal(releaseReadiness(both, prev, actual).verdict, "APPROVED_FOR_DEPLOYMENT");
  });
  it("a missing rollback blocks the release", () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "klynge-rel-"));
    cpSync(path.join(APP_ROOT, "supabase"), path.join(tmp, "supabase"), { recursive: true });
    writeFileSync(path.join(tmp, "package.json"), readFileSync(path.join(APP_ROOT, "package.json")));
    rmSync(path.join(tmp, "supabase/rollback/0004_klynge_pilot.down.sql"));
    assert.equal(releaseReadiness(m, prev, actualState(tmp)).verdict, "BLOCKED");
  });
});
