import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MemoryAccountStore } from "./account/memory-account-store.ts";
import { accessMode, pilotGateVerdict } from "./pilot/access.ts";
import { MemoryPilotStore } from "./pilot/memory-pilot-store.ts";
import { activatePilot, onboarding, submitFeedback, updateOnboarding } from "./pilot/pilot.ts";
import { pilotStateOf } from "./pilot/types.ts";
import { corpusImage, MIN, T, testDeps, USER_A, USER_B } from "./test-support.ts";
import { confirmField, uploadChart, WorkspaceError } from "./workspace.ts";

const deps = () => {
  const pilot = new MemoryPilotStore();
  const account = new MemoryAccountStore();
  return { ...testDeps(), pilot, account };
};

describe("pilot access mode + gate (Batch 71)", () => {
  it("production deployments are invite-only until general availability is explicitly authorized", () => {
    assert.equal(accessMode({ KLYNGE_DEPLOYMENT: "production" }), "invite-only");
    assert.equal(accessMode({ VERCEL_ENV: "production", KLYNGE_ACCESS: "open" }), "invite-only", "open alone is not a release authorization");
    assert.equal(accessMode({ VERCEL_ENV: "production", KLYNGE_ACCESS: "open", KLYNGE_RELEASE_AUTHORIZED: "general-availability" }), "open");
    assert.equal(accessMode({}), "open", "local development default");
    assert.equal(accessMode({ KLYNGE_ACCESS: "invite-only" }), "invite-only");
  });
  it("the test header can force a mode only in test mode", () => {
    const h = new Headers({ "x-klynge-access": "invite-only" });
    assert.equal(accessMode({}, h), "open");
    assert.equal(accessMode({ KLYNGE_TEST_MODE: "1" }, h), "invite-only");
    assert.throws(() => accessMode({ KLYNGE_TEST_MODE: "1", KLYNGE_DEPLOYMENT: "production" }, h), /production/, "test overrides refuse to run in production");
  });
  it("gate: anonymous must sign in; only ACTIVE users pass; operators pass; open mode passes everyone", () => {
    assert.equal(pilotGateVerdict("invite-only", "TRIAL", null, false), "SIGN_IN_REQUIRED");
    for (const s of ["NOT_INVITED", "INVITED", "SUSPENDED", "COMPLETED"] as const) assert.equal(pilotGateVerdict("invite-only", "USER", s, false), s);
    assert.equal(pilotGateVerdict("invite-only", "USER", null, false), "NOT_INVITED");
    assert.equal(pilotGateVerdict("invite-only", "USER", "ACTIVE", false), null);
    assert.equal(pilotGateVerdict("invite-only", "USER", "NOT_INVITED", true), null);
    assert.equal(pilotGateVerdict("open", "TRIAL", null, false), null);
  });
});

describe("invite-only enrollment (Batch 71)", () => {
  it("states: NOT_INVITED → INVITED → ACTIVE → SUSPENDED → COMPLETED; revoked invites do not count", () => {
    const inv = { email: "a@example.com", cohort: "pilot-1", invitedAt: 1, revokedAt: null };
    assert.equal(pilotStateOf(null, null), "NOT_INVITED");
    assert.equal(pilotStateOf(inv, null), "INVITED");
    assert.equal(pilotStateOf({ ...inv, revokedAt: 2 }, null), "NOT_INVITED");
    const e = { tenantId: USER_A, status: "ACTIVE" as const, cohort: "pilot-1", activatedAt: 3, riskAckVersion: "r", consentVersion: "c", statusChangedAt: 3, statusReason: null };
    assert.equal(pilotStateOf(inv, e), "ACTIVE");
    assert.equal(pilotStateOf(inv, { ...e, status: "SUSPENDED" }), "SUSPENDED");
  });
  it("activation needs an invite for the verified email plus explicit risk acknowledgement and consent", async () => {
    const d = deps();
    await assert.rejects(activatePilot(d, { tenantId: USER_A, email: "ada@example.com", riskAcknowledged: true, consent: true, now: T }), /No pilot invitation/);
    d.pilot.invite("Ada@Example.com", "pilot-1", T);
    for (const [risk, consent] of [[false, true], [true, false], ["yes", true], [true, 1]] as const) {
      await assert.rejects(activatePilot(d, { tenantId: USER_A, email: "ada@example.com", riskAcknowledged: risk, consent, now: T }), WorkspaceError);
    }
    const e = await activatePilot(d, { tenantId: USER_A, email: "ADA@example.com", riskAcknowledged: true, consent: true, now: T + 1 });
    assert.deepEqual([e.status, e.cohort, e.riskAckVersion, e.consentVersion], ["ACTIVE", "pilot-1", "risk-ack-v1", "pilot-consent-v1"]);
    assert.ok((await d.account.listAudit(USER_A)).some((a) => a.action === "pilot.activated"));
    assert.deepEqual(await activatePilot(d, { tenantId: USER_A, email: "ada@example.com", riskAcknowledged: true, consent: true, now: T + 2 }), e, "idempotent");
  });
  it("an invite for someone else's address cannot be used; suspended users cannot reinstate themselves", async () => {
    const d = deps();
    d.pilot.invite("ada@example.com", "pilot-1", T);
    await assert.rejects(activatePilot(d, { tenantId: USER_B, email: "bob@example.com", riskAcknowledged: true, consent: true, now: T }), /No pilot invitation/);
    await activatePilot(d, { tenantId: USER_A, email: "ada@example.com", riskAcknowledged: true, consent: true, now: T });
    d.pilot.setStatus(USER_A, "SUSPENDED", "operator review", T + 1);
    await assert.rejects(activatePilot(d, { tenantId: USER_A, email: "ada@example.com", riskAcknowledged: true, consent: true, now: T + 2 }), /not available/);
    assert.equal((await d.pilot.getEnrollment(USER_A))?.status, "SUSPENDED");
  });
});

describe("guided onboarding (Batch 72)", () => {
  it("progress is derived from the user's own state; telemetry carries step ids only", async () => {
    const d = deps();
    let v = await onboarding(d, USER_A, "s1");
    assert.deepEqual(v.steps.map((s) => s.id), ["evidence-modes", "chart-set", "corrections", "verified-data", "workspace-tools"]);
    assert.equal(v.completed, 0);
    await updateOnboarding(d, USER_A, "acknowledge-evidence-modes", T);
    for (const [img, dt] of [["tsla-5m-bull", 0], ["spx-5m-bull", 1], ["mnq-5m-bull", 2]] as const) await uploadChart(d, { tenantId: USER_A, sessionId: "s1", bytes: corpusImage(img), hints: {}, actor: "user", now: T + dt * MIN });
    const session = await d.store.getSession(USER_A, "s1");
    await confirmField(d, { tenantId: USER_A, sessionId: "s1", chartId: session!.charts[0]!.chartId, edit: { field: "symbol", action: "CONFIRM" }, actor: "user", now: T + 3 * MIN });
    v = await onboarding(d, USER_A, "s1");
    assert.deepEqual(v.steps.filter((s) => s.done).map((s) => s.id), ["evidence-modes", "chart-set", "corrections"]);
    assert.equal((await onboarding(d, USER_B, "s1")).completed, 0, "another user's progress is independent");
    const onb = d.telemetry.events.filter((e) => e.name === "onboarding.step");
    assert.deepEqual(onb.map((e) => e.attrs), [{ step: "evidence-modes" }]);
    await updateOnboarding(d, USER_A, "dismiss", T + 4 * MIN);
    assert.equal((await onboarding(d, USER_A, "s1")).dismissed, true);
    await assert.rejects(updateOnboarding(d, USER_A, "complete-everything", T), WorkspaceError);
  });
});

describe("structured feedback (Batch 74)", () => {
  it("stores USER_REPORTED feedback tied to the session; foreign record ids are dropped; decisions are untouched", async () => {
    const d = deps();
    await uploadChart(d, { tenantId: USER_A, sessionId: "s1", bytes: corpusImage("tsla-5m-bull"), hints: {}, actor: "user", now: T });
    const before = JSON.stringify(await d.store.listRecords(USER_A));
    const mine = (await d.store.listRecords(USER_A))[0]!.recordId;
    const f = await submitFeedback(d, { tenantId: USER_A, sessionId: "s1", body: { recordId: mine, ratings: { clarity: 4, usefulness: 9, confidence: "5" }, missingInformation: "  Earnings date\u0000 ", problem: { category: "DATA", description: "SPX chart was cropped" }, decision: "CALL_SETUP", kind: "VERIFIED_DEFECT" }, now: T + 1 });
    assert.equal(f.kind, "USER_REPORTED");
    assert.deepEqual(f.ratings, { clarity: 4, confidence: null, usability: null, usefulness: null });
    assert.equal(f.missingInformation, "Earnings date");
    assert.equal(f.recordId, mine);
    assert.equal(JSON.stringify(await d.store.listRecords(USER_A)), before, "feedback never changes engine records");
    const g = await submitFeedback(d, { tenantId: USER_B, sessionId: "s2", body: { recordId: mine, ratings: { usability: 2 } }, now: T + 2 });
    assert.equal(g.recordId, null, "cannot tie feedback to another user's record");
    assert.equal((await d.pilot.listFeedback(USER_B)).length, 1);
    assert.equal((await d.pilot.listFeedback(USER_A)).length, 1);
    const ev = d.telemetry.events.filter((e) => e.name === "feedback.submitted");
    assert.ok(!JSON.stringify(ev).includes("cropped") && !JSON.stringify(ev).includes("Earnings"), "no free text in telemetry");
  });
  it("empty feedback is rejected; feedback is rate limited", async () => {
    const d = { ...deps(), limiter: new (await import("./rate-limit.ts")).RateLimiter({ capacity: 2, refillPerMs: 0 }) };
    await assert.rejects(submitFeedback(d, { tenantId: USER_A, sessionId: "s", body: {}, now: T }), /Add a rating/);
    await submitFeedback(d, { tenantId: USER_A, sessionId: "s", body: { ratings: { clarity: 3 } }, now: T + 1 });
    await assert.rejects(submitFeedback(d, { tenantId: USER_A, sessionId: "s", body: { ratings: { clarity: 3 } }, now: T + 2 }), /Too much feedback/);
  });
});

describe("hosted readiness covers pilot access (Batch 71)", () => {
  it("an open hosted deployment without release authorization is NOT READY", async () => {
    const { readinessSummary, validateHostedEnv } = await import("./admin/readiness.ts");
    const jwt = (x: string) => `eyJ${x}.eyJ${x}.${x}`;
    const env = { NEXT_PUBLIC_SUPABASE_URL: "https://mdshgiqynukrbkyxgmur.supabase.co", SUPABASE_URL: "https://mdshgiqynukrbkyxgmur.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("pub"), SUPABASE_SERVICE_ROLE_KEY: jwt("sec"), KLYNGE_SITE_URL: "https://k.example", KLYNGE_STORE: "supabase", KLYNGE_DEPLOYMENT: "production" };
    assert.ok(readinessSummary(validateHostedEnv({ ...env, KLYNGE_ACCESS: "open" })).failed.includes("pilot.access"));
    assert.equal(readinessSummary(validateHostedEnv({ ...env, KLYNGE_ACCESS: "open", KLYNGE_RELEASE_AUTHORIZED: "general-availability" })).failed.includes("pilot.access"), false);
  });
});

describe("mock auth codes are unique single-use tokens (defect found by the Batch 80 journeys)", () => {
  it("two codes for the same email in the same second both redeem", async () => {
    const { MockAuthGateway } = await import("./auth/mock-auth.ts");
    const { memoryJar } = await import("./test-support.ts");
    const env = { KLYNGE_TEST_MODE: "1", KLYNGE_AUTH: "mock", KLYNGE_TEST_AUTH_SECRET: "unit-test-secret" };
    const g = new MockAuthGateway(memoryJar(), { env, clock: () => 1_780_000_000_000 });
    const a = g.issueOAuthCode("ops@example.com");
    const b = g.issueOAuthCode("ops@example.com");
    assert.notEqual(a, b);
    assert.equal((await g.exchangeCode(a)).email, "ops@example.com");
    assert.equal((await new MockAuthGateway(memoryJar(), { env, clock: () => 1_780_000_000_000 }).exchangeCode(b)).email, "ops@example.com");
    await assert.rejects(g.exchangeCode(a), /expired or invalid/, "still single use");
  });
});
