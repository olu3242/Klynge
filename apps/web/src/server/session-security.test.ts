import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MOCK_SESSION_COOKIE, MockAuthGateway } from "./auth/mock-auth.ts";
import { authMode } from "./auth/select.ts";
import { SupabaseAuthGateway } from "./auth/supabase-auth.ts";
import { csrfVerdict } from "./csrf.ts";
import { resolveIdentity, SESSION_COOKIE, TRIAL_COOKIE } from "./identity.ts";
import { isTestMode } from "./test-mode.ts";
import { corpusImage, memoryJar, testDeps, TRIAL_A, trialDeps, USER_A, USER_B } from "./test-support.ts";
import { promoteTrial, uploadChart, WorkspaceError } from "./workspace.ts";

const ENV = { KLYNGE_TEST_MODE: "1", KLYNGE_AUTH: "mock", KLYNGE_TEST_AUTH_SECRET: "session-security" };
const SID = "88888888-8888-4888-a888-888888888888";
const TRIAL = "99999999-9999-4999-a999-999999999999";
const req = (method: string, headers: Record<string, string>) => csrfVerdict(method, new URL("http://127.0.0.1:3100/api/journal"), new Headers({ host: "127.0.0.1:3100", ...headers }));

describe("CSRF protection (state-changing requests)", () => {
  it("same-origin POST passes; cross-origin and cross-site POSTs are rejected", () => {
    assert.deepEqual(req("POST", { origin: "http://127.0.0.1:3100" }), { ok: true });
    assert.equal(req("POST", { origin: "https://evil.example" }).ok, false);
    assert.equal(req("POST", { origin: "null" }).ok, false, "sandboxed/opaque origin");
    assert.equal(req("POST", { "sec-fetch-site": "cross-site" }).ok, false);
    assert.equal(req("POST", { "sec-fetch-site": "same-site" }).ok, false, "sibling subdomains are not trusted");
    assert.deepEqual(req("POST", { "sec-fetch-site": "same-origin" }), { ok: true });
    assert.deepEqual(req("GET", { origin: "https://evil.example" }), { ok: true }, "safe methods never mutate");
  });
  it("behind a proxy the configured site URL is authoritative", () => {
    const v = csrfVerdict("POST", new URL("http://internal:3100/x"), new Headers({ host: "internal:3100", origin: "https://klynge.app" }), "https://klynge.app");
    assert.deepEqual(v, { ok: true });
    assert.equal(csrfVerdict("POST", new URL("http://internal:3100/x"), new Headers({ origin: "http://internal:3100" }), "https://klynge.app").ok, false);
  });
});

describe("session lifecycle: expiry, revocation, reuse", () => {
  it("sign-out revokes the session id: a copied cookie stops working", async () => {
    const jar = memoryJar();
    const g = new MockAuthGateway(jar, { env: ENV });
    await g.exchangeCode(g.issueOAuthCode("zoe@example.com"));
    const stolen = jar.get(MOCK_SESSION_COOKIE)!;
    await g.signOut();
    const attacker = memoryJar({ [MOCK_SESSION_COOKIE]: stolen });
    assert.equal(await new MockAuthGateway(attacker, { env: ENV }).getUser(), null);
  });
  it("sessions expire (absolute lifetime)", async () => {
    let now = 1_800_000_000_000;
    const jar = memoryJar();
    const g = new MockAuthGateway(jar, { env: ENV, clock: () => now });
    await g.exchangeCode(g.issueOAuthCode("yan@example.com"));
    now += 7 * 3_600_000;
    assert.ok(await g.getUser());
    now += 2 * 3_600_000;
    assert.equal(await g.getUser(), null);
  });
  it("Supabase sign-out is global (server-side refresh-token revocation)", async () => {
    const g = new SupabaseAuthGateway(memoryJar(), { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" });
    let scope: unknown;
    Object.assign(g.client.auth, { signOut: async (o: { scope: string }) => ((scope = o.scope), { error: null }) });
    await g.signOut();
    assert.equal(scope, "global");
  });
  it("an expired/invalid session falls back to an anonymous trial — never to another user", async () => {
    const jar = memoryJar({ [SESSION_COOKIE]: SID, [TRIAL_COOKIE]: TRIAL, [MOCK_SESSION_COOKIE]: "garbage.sig" });
    const id = await resolveIdentity(new MockAuthGateway(jar, { env: ENV }), jar);
    assert.equal(id.kind, "TRIAL");
  });
});

describe("privilege escalation + promotion consent", () => {
  it("a user cannot promote a trial into another user's account or re-own durable data", async () => {
    const trial = trialDeps();
    await uploadChart(trial, { tenantId: TRIAL_A, sessionId: SID, bytes: corpusImage("tsla-5m-bull"), hints: {}, actor: "anon", now: 1 });
    const durable = testDeps();
    await promoteTrial(trial.store, durable, { trialTenantId: TRIAL_A, trialSessionId: SID, userId: USER_A, newSessionId: SID, now: 2 });
    assert.equal(await durable.store.getSession(USER_B, SID), undefined);
    assert.equal((await trial.store.getSession(TRIAL_A, SID))?.tenantId, TRIAL_A, "trial never re-owned");
  });
  it("a trial id can never act as a durable tenant", async () => {
    await assert.rejects(promoteTrial(trialDeps().store, trialDeps(), { trialTenantId: TRIAL_A, trialSessionId: SID, userId: TRIAL_A, newSessionId: SID, now: 1 }), (e: unknown) => e instanceof WorkspaceError && e.code === "AUTH_REQUIRED");
  });
});

describe("test-only mechanisms cannot run in production", () => {
  it("test mode refuses production deployments and production builds outside the e2e harness", () => {
    assert.throws(() => isTestMode({ KLYNGE_TEST_MODE: "1", VERCEL_ENV: "production" }), /production deployment/);
    assert.throws(() => isTestMode({ KLYNGE_TEST_MODE: "1", KLYNGE_DEPLOYMENT: "production" }), /production deployment/);
    assert.throws(() => isTestMode({ KLYNGE_TEST_MODE: "1", NODE_ENV: "production" }), /e2e harness/);
    assert.equal(isTestMode({ KLYNGE_TEST_MODE: "1", NODE_ENV: "production", KLYNGE_E2E_RUN: "1" }), true);
    assert.equal(isTestMode({ NODE_ENV: "production" }), false);
    assert.throws(() => authMode({ KLYNGE_AUTH: "mock", NODE_ENV: "production" }), /requires KLYNGE_TEST_MODE/);
  });
});

describe("bundle guard covers 0.6.0 internals and new server-only credentials", () => {
  it("flags calibration/backtest/user-policy/calendar internals and provider/email/cron secrets", async () => {
    const { mkdirSync, mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const { pathToFileURL } = await import("node:url");
    const { APP_ROOT } = await import("./test-support.ts");
    const mod = (await import(pathToFileURL(path.join(APP_ROOT, "scripts/check-client-bundle.mjs")).href)) as { scan: (dir: string) => string[] };
    const dir = mkdtempSync(path.join(tmpdir(), "klynge-bundle3-"));
    mkdirSync(path.join(dir, "chunks"));
    for (const leak of ["production-calibration-v1", "sensitivitySweep", "runBacktest", "applyUserPolicy", "NYSE_HOLIDAYS", "composeNotification", "POLYGON_API_KEY", "RESEND_API_KEY", "KLYNGE_CRON_SECRET", "api.polygon.io"]) {
      writeFileSync(path.join(dir, "chunks/leak.js"), `var x=${JSON.stringify(leak)};`);
      assert.ok(mod.scan(dir).length >= 1, leak);
    }
  });
});
