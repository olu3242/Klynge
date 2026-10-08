import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MOCK_SESSION_COOKIE, MockAuthGateway, mockOutbox, mockUserId } from "./auth/mock-auth.ts";
import { safeNext, siteOrigin } from "./auth/redirect.ts";
import { authMode, gatewayFor } from "./auth/select.ts";
import { SupabaseAuthGateway } from "./auth/supabase-auth.ts";
import { AuthError } from "./auth/types.ts";
import { isTestMode } from "./test-mode.ts";
import { memoryJar } from "./test-support.ts";

const TEST_ENV = { KLYNGE_TEST_MODE: "1", KLYNGE_AUTH: "mock", KLYNGE_TEST_AUTH_SECRET: "test-secret-for-unit-tests" };
const gw = (jar = memoryJar(), clock?: () => number) => new MockAuthGateway(jar, { env: TEST_ENV, ...(clock ? { clock } : {}) });

describe("Google OAuth (mock gateway, offline)", () => {
  it("start → consent code → callback exchange → verified session cookie", async () => {
    const jar = memoryJar();
    const g = gw(jar);
    const { url } = await g.startOAuth("google", "http://localhost/auth/callback?next=/app");
    assert.match(url, /^\/auth\/mock\/google\?redirect_to=/);
    const user = await g.exchangeCode(g.issueOAuthCode("Ada@Example.com"));
    assert.deepEqual(user, { id: mockUserId("ada@example.com"), email: "ada@example.com", method: "google" });
    assert.match(user.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
    const cookie = jar.store.get(MOCK_SESSION_COOKIE);
    assert.equal(cookie?.options?.httpOnly, true);
    assert.deepEqual(await g.getUser(), user);
  });
  it("codes are single-use and cannot be used as sessions", async () => {
    const jar = memoryJar();
    const g = gw(jar);
    const code = g.issueOAuthCode("bob@example.com");
    await g.exchangeCode(code);
    await assert.rejects(g.exchangeCode(code), (e: unknown) => e instanceof AuthError && e.code === "INVALID_CODE");
    jar.set(MOCK_SESSION_COOKIE, g.issueOAuthCode("eve@example.com"));
    assert.equal(await g.getUser(), null, "a code is not a session");
  });
});

describe("email magic link (mock gateway, offline)", () => {
  it("send → outbox link → confirm → verified session", async () => {
    const jar = memoryJar();
    const g = gw(jar);
    await g.sendMagicLink("cleo@example.com", "/auth/confirm?next=%2Fapp");
    const link = new URL(mockOutbox.latest("cleo@example.com")!, "http://x");
    assert.equal(link.pathname, "/auth/confirm");
    assert.equal(link.searchParams.get("type"), "magiclink");
    const user = await g.verifyMagicLink(link.searchParams.get("token_hash")!, "magiclink");
    assert.deepEqual([user.email, user.method], ["cleo@example.com", "email"]);
    assert.equal((await g.getUser())?.id, user.id);
    await assert.rejects(g.verifyMagicLink(link.searchParams.get("token_hash")!, "magiclink"), /expired or invalid/, "single use");
  });
  it("rejects bad emails, wrong link types and expired links", async () => {
    const g = gw();
    await assert.rejects(g.sendMagicLink("not-an-email", "/auth/confirm"), (e: unknown) => e instanceof AuthError && e.code === "INVALID_EMAIL");
    let now = 1_000_000_000_000;
    const timed = gw(memoryJar(), () => now);
    await timed.sendMagicLink("dan@example.com", "/auth/confirm");
    const token = new URL(mockOutbox.latest("dan@example.com")!, "http://x").searchParams.get("token_hash")!;
    await assert.rejects(timed.verifyMagicLink(token, "recovery"), /expired or invalid/);
    now += 10 * 60_000;
    await assert.rejects(timed.verifyMagicLink(token, "magiclink"), /expired or invalid/);
  });
});

describe("session verification (never trust a cookie value)", () => {
  it("tampered, forged, expired and foreign-secret sessions are rejected", async () => {
    const jar = memoryJar();
    let now = 1_000_000_000_000;
    const g = gw(jar, () => now);
    await g.exchangeCode(g.issueOAuthCode("fay@example.com"));
    const good = jar.get(MOCK_SESSION_COOKIE)!;
    const [body, sig] = good.split(".");
    const claims = JSON.parse(Buffer.from(body!, "base64url").toString());
    const forged = Buffer.from(JSON.stringify({ ...claims, sub: mockUserId("victim@example.com"), email: "victim@example.com" })).toString("base64url");
    for (const bad of [`${forged}.${sig}`, `${body}.AAAA`, "garbage", JSON.stringify({ sub: "x" })]) {
      jar.set(MOCK_SESSION_COOKIE, bad);
      assert.equal(await g.getUser(), null, bad.slice(0, 20));
    }
    jar.set(MOCK_SESSION_COOKIE, good);
    assert.equal((await new MockAuthGateway(jar, { env: { ...TEST_ENV, KLYNGE_TEST_AUTH_SECRET: "other" }, clock: () => now }).getUser()), null);
    now += 9 * 60 * 60_000;
    assert.equal(await g.getUser(), null, "expired");
  });
  it("sign out clears the session", async () => {
    const jar = memoryJar();
    const g = gw(jar);
    await g.exchangeCode(g.issueOAuthCode("gus@example.com"));
    await g.signOut();
    assert.equal(await g.getUser(), null);
  });
});

describe("auth mode selection + test-mode guard", () => {
  it("mock auth requires test mode; test mode refuses production deployments", () => {
    assert.throws(() => authMode({ KLYNGE_AUTH: "mock" }), /requires KLYNGE_TEST_MODE=1/);
    assert.equal(authMode(TEST_ENV), "mock");
    assert.throws(() => isTestMode({ KLYNGE_TEST_MODE: "1", VERCEL_ENV: "production" }), /cannot be enabled in a production/);
    assert.equal(authMode({}), "disabled");
    assert.equal(authMode({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" }), "supabase");
    assert.equal(gatewayFor(memoryJar(), {}).kind, "disabled");
  });
  it("disabled gateway: trial only, sign-in reports NOT_CONFIGURED", async () => {
    const g = gatewayFor(memoryJar(), {});
    assert.equal(await g.getUser(), null);
    await assert.rejects(g.startOAuth("google", "/x"), (e: unknown) => e instanceof AuthError && e.code === "NOT_CONFIGURED");
  });
});

describe("Supabase Auth gateway (anon key only; verified getUser)", () => {
  const env = { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-anon-key" };
  it("requires the public URL + anon key (never the service role)", () => {
    assert.throws(() => new SupabaseAuthGateway(memoryJar(), { SUPABASE_URL: "https://x", SUPABASE_SERVICE_ROLE_KEY: "secret" }), (e: unknown) => e instanceof AuthError && e.code === "NOT_CONFIGURED");
  });
  it("maps Google OAuth, magic link, callbacks and getUser through the Auth server", async () => {
    const g = new SupabaseAuthGateway(memoryJar(), env);
    const calls: [string, unknown][] = [];
    const user = { id: "44444444-4444-4444-a444-444444444444", email: "ivy@example.com", app_metadata: { provider: "google" } };
    Object.assign(g.client.auth, {
      signInWithOAuth: async (a: unknown) => (calls.push(["oauth", a]), { data: { url: "https://accounts.google.com/o/oauth2" }, error: null }),
      signInWithOtp: async (a: unknown) => (calls.push(["otp", a]), { data: {}, error: null }),
      exchangeCodeForSession: async (c: unknown) => (calls.push(["exchange", c]), { data: { user }, error: null }),
      verifyOtp: async (a: unknown) => (calls.push(["verify", a]), { data: { user: { ...user, app_metadata: { provider: "email" } } }, error: null }),
      getUser: async () => ({ data: { user }, error: null }),
      signOut: async () => (calls.push(["signout", null]), { error: null }),
    });
    assert.equal((await g.startOAuth("google", "https://app/auth/callback")).url, "https://accounts.google.com/o/oauth2");
    await g.sendMagicLink("ivy@example.com", "https://app/auth/confirm");
    assert.equal((await g.exchangeCode("code-1")).method, "google");
    assert.equal((await g.verifyMagicLink("hash-1", "magiclink")).method, "email");
    assert.deepEqual(await g.getUser(), { id: user.id, email: user.email, method: "google" });
    await g.signOut();
    assert.deepEqual(calls[0], ["oauth", { provider: "google", options: { redirectTo: "https://app/auth/callback", skipBrowserRedirect: true } }]);
    assert.deepEqual(calls[1], ["otp", { email: "ivy@example.com", options: { emailRedirectTo: "https://app/auth/confirm", shouldCreateUser: true } }]);
    await assert.rejects(g.verifyMagicLink("hash", "recovery"), /expired or invalid/);
    Object.assign(g.client.auth, { getUser: async () => ({ data: { user: null }, error: { message: "invalid JWT" } }) });
    assert.equal(await g.getUser(), null);
  });
});

describe("redirect safety", () => {
  it("only same-origin relative paths survive", () => {
    assert.equal(safeNext("/app/history?symbol=TSLA"), "/app/history?symbol=TSLA");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "", null, "/app\r\nSet-Cookie: x=1"]) assert.equal(safeNext(bad), "/app", String(bad));
    assert.equal(siteOrigin(new Request("http://internal:3100/x"), { KLYNGE_SITE_URL: "https://klynge.app/path" }), "https://klynge.app");
    assert.equal(siteOrigin(new Request("http://localhost:3100/x", { headers: { host: "127.0.0.1:3100" } }), {}), "http://127.0.0.1:3100", "browser host, not the bind address");
    assert.equal(siteOrigin(new Request("http://localhost:3100/x", { headers: { host: "evil.example/../x" } }), {}), "http://localhost:3100", "malformed host ignored");
  });
});
