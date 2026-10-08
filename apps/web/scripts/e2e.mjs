/**
 * End-to-end certification (run after `next build`). Starts `next start` in TEST MODE: mock extractor, mock auth
 * (Google OAuth + magic link, HMAC-signed), mock market-data provider over a recorded fixture, file store (so a
 * real process restart can be certified) and an injectable clock. Drives the real UI in Chromium.
 * No network, no credentials, no model calls.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = Number(process.env.E2E_PORT ?? 3197);
const BASE = `http://127.0.0.1:${PORT}`;
const T = 1_780_000_000_000;
const MIN = 60_000;
const img = (id) => path.join(ROOT, "test/corpus/images", `${id}.png`);
const OHLCV = path.join(ROOT, "test/fixtures/ohlcv-call.json");
const END = JSON.parse(readFileSync(OHLCV, "utf8")).asOf;
const DIRECTIONAL = /CALL_SETUP|PUT_SETUP|ELIGIBLE|CONDITIONS MET/;
const STATE_DIR = mkdtempSync(path.join(tmpdir(), "klynge-e2e-"));
const results = [];
let logs = "";

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const SERVER_ENV = {
  ...process.env,
  NODE_ENV: "production",
  KLYNGE_TEST_MODE: "1",
  KLYNGE_E2E_RUN: "1",
  KLYNGE_AUTH: "mock",
  KLYNGE_TEST_AUTH_SECRET: "e2e-only-secret-not-for-production",
  KLYNGE_EXTRACTOR: "mock",
  KLYNGE_PROVIDER: "mock",
  KLYNGE_STORE: "file",
  KLYNGE_STORE_FILE: path.join(STATE_DIR, "store.json"),
  KLYNGE_ACCOUNT_STORE_FILE: path.join(STATE_DIR, "account.json"),
  KLYNGE_EMAIL: "mock",
  KLYNGE_IMAGE_RETENTION: "SESSION",
  KLYNGE_CRON_SECRET: "e2e-cron-secret-not-for-production-000000",
  KLYNGE_ADMIN_EMAILS: "ops@example.com",
};
const CRON = SERVER_ENV.KLYNGE_CRON_SECRET;

let server;
async function portBusy() {
  try {
    await fetch(`${BASE}/app`, { redirect: "manual" });
    return true;
  } catch {
    return false;
  }
}
async function startServer() {
  if (await portBusy()) throw new Error(`port ${PORT} is already in use — stop the stale server first (or set E2E_PORT)`);
  server = spawn(process.execPath, [path.join(ROOT, "node_modules/next/dist/bin/next"), "start", "-p", String(PORT), "-H", "127.0.0.1"], { cwd: ROOT, env: SERVER_ENV, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (d) => (logs += d));
  server.stderr.on("data", (d) => (logs += d));
  for (let i = 0; i < 160; i++) {
    try {
      if ((await fetch(`${BASE}/app`, { redirect: "manual" })).status < 500) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server did not start:\n${logs}`);
}
async function stopServer() {
  if (!server) return;
  const exited = new Promise((r) => server.once("exit", r));
  server.kill("SIGTERM");
  await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
  server = undefined;
}

await startServer();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

async function workspace(now, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport, extraHTTPHeaders: { "x-klynge-now": String(now) } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${BASE}/app`);
  let headers = { "x-klynge-now": String(now) };
  const setHeaders = (h) => {
    headers = { ...headers, ...h };
    for (const [k, v] of Object.entries(headers)) if (v === null) delete headers[k];
    return context.setExtraHTTPHeaders(headers);
  };
  const clock = (t) => setHeaders({ "x-klynge-now": String(t) });
  const scenario = (s) => setHeaders({ "x-klynge-provider-scenario": s });
  const upload = async (id, t, { role } = {}) => {
    await clock(t);
    if (role) await page.getByLabel("Chart role").selectOption(role);
    const done = page.waitForResponse((r) => r.url().endsWith("/api/charts"));
    await page.locator('input[type=file][accept^="image"]').setInputFiles(img(id));
    await done;
    if (role) await page.getByLabel("Chart role").selectOption("");
  };
  const label = () => page.getByTestId("visual-label").innerText();
  const permission = () => page.getByTestId("visual-permission").innerText();
  const status = (role, field) => page.locator(`[data-testid=chart-${role}] tr[data-field=${field}] [data-status]`).getAttribute("data-status");
  // Direct API probes share the browser context's cookies + headers but never touch the page (no console noise).
  const api = async (url, init = {}) => {
    const r = await context.request.fetch(`${BASE}${url}`, { method: init.method ?? "GET", headers: init.headers ?? {}, ...(init.body ? { data: init.body } : {}) });
    let body = null;
    try {
      body = await r.json();
    } catch {
      // empty body
    }
    return { status: r.status(), body };
  };
  return { context, page, errors, clock, scenario, upload, label, permission, status, api };
}

async function signInGoogle(w, email) {
  await w.page.goto(`${BASE}/sign-in?next=/app`);
  await w.page.getByRole("button", { name: "Continue with Google" }).click();
  await w.page.waitForURL(/\/auth\/mock\/google/);
  await w.page.getByLabel("Google account email").fill(email);
  await w.page.getByRole("button", { name: "Continue" }).click();
  await w.page.waitForURL(/\/app/);
}
async function signInMagicLink(w, email) {
  await w.page.goto(`${BASE}/sign-in?next=/app`);
  await w.page.getByLabel("Email address").fill(email);
  await w.page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await w.page.getByTestId("magic-link-sent").waitFor();
  const outbox = await w.api(`/api/test/outbox?email=${encodeURIComponent(email)}`);
  if (outbox.status !== 200) throw new Error("no magic link in the test outbox");
  await w.page.goto(new URL(outbox.body.link, BASE).toString());
  await w.page.waitForURL(/\/app/);
}
const connect = async (w, symbol) => {
  const done = w.page.waitForResponse((r) => r.url().endsWith("/api/data/connect"));
  if (symbol) await w.page.getByTestId("data-connect").getByLabel(/^Symbol/).fill(symbol);
  await w.page.getByRole("button", { name: "Connect verified data" }).click();
  await done;
  await w.page.getByTestId("runtime-status").waitFor();
  return { status: await w.page.getByTestId("runtime-status").getAttribute("data-status"), text: await w.page.getByTestId("runtime-status").innerText() };
};

try {
  // ── 1. Anonymous trial: TSLA → missing context → SPX + MNQ → BULLISH CONTEXT / WAIT ──────────────────
  const w = await workspace(T);
  await w.upload("tsla-5m-bull", T);
  check("TSLA alone => INSUFFICIENT CONTEXT", (await w.label()) === "INSUFFICIENT CONTEXT", await w.label());
  check("missing context offers + Add SPX / MNQ", (await w.page.getByRole("button", { name: "+ Add SPX chart" }).count()) > 0 && (await w.page.getByRole("button", { name: "+ Add MNQ chart" }).count()) > 0);
  await w.upload("spx-5m-bull", T + MIN);
  await w.upload("mnq-5m-bull", T + 2 * MIN);
  await w.page.getByTestId("visual-label").filter({ hasText: "BULLISH CONTEXT" }).waitFor();
  check("TSLA + SPX + MNQ => BULLISH CONTEXT", (await w.label()) === "BULLISH CONTEXT");
  check("visual permission is WAIT", (await w.permission()).includes("WAIT"), await w.permission());
  check("verification notice visible", (await w.page.getByTestId("visual-notice").innerText()).includes("Conditions observed — data verification required"));
  check("risk notice visible", await w.page.getByText("Klynge is not financial advice.").first().isVisible());
  const visualText = await w.page.locator("main").innerText();
  check("no CALL/PUT/ELIGIBLE language in VISUAL mode", !DIRECTIONAL.test(visualText));
  check("evidence mode shown: VISUAL ANALYSIS / data verification required", (await w.page.getByTestId("evidence-mode").getAttribute("data-mode")) === "VISUAL" && /VISUAL ANALYSIS[\s\S]*Data verification required/.test(await w.page.getByTestId("evidence-mode").innerText()));
  check("anonymous upload works as a trial (trial notice shown)", await w.page.getByTestId("trial-notice").isVisible());

  // ── 2. Anonymous cannot persist ─────────────────────────────────────────────────────────────────────
  const anonJournal = await w.api("/api/journal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recordId: "x", note: "n" }) });
  const anonOhlcv = await w.api("/api/ohlcv", { method: "POST", headers: { "content-type": "application/json" }, body: readFileSync(OHLCV, "utf8") });
  const anonConnect = await w.api("/api/data/connect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol: "TSLA" }) });
  const anonHistory = await w.api("/api/history");
  check("anonymous cannot persist journal / decisions / data / history (401)", [anonJournal, anonOhlcv, anonConnect, anonHistory].every((r) => r.status === 401), [anonJournal, anonOhlcv, anonConnect, anonHistory].map((r) => r.status).join(","));
  check("anonymous has no persisted alerts", (await w.api("/api/workspace")).body.alerts.length === 0);
  await w.page.goto(`${BASE}/app/history`);
  check("protected route: /app/history redirects anonymous users to sign-in", w.page.url().includes("/sign-in"));
  await w.page.goto(`${BASE}/app`);

  // ── 3. Confirmation + stale set (still anonymous) ───────────────────────────────────────────────────
  await w.page.locator("[data-testid=chart-TARGET]").getByRole("button", { name: "Confirm Symbol" }).click();
  await w.page.locator("[data-testid=chart-TARGET] tr[data-field=symbol] [data-status=USER_CONFIRMED]").waitFor();
  check("confirm field => USER_CONFIRMED", (await w.status("TARGET", "symbol")) === "USER_CONFIRMED");
  await w.clock(T + 30 * MIN);
  await w.page.locator("[data-testid=chart-SPX]").getByRole("button", { name: "Confirm Symbol" }).click();
  await w.page.getByTestId("visual-permission").filter({ hasText: "BLOCKED" }).waitFor();
  check("stale chart set => BLOCKED", (await w.permission()).includes("BLOCKED"));

  // ── 4. Google OAuth (mock) + explicit anonymous promotion ───────────────────────────────────────────
  await w.clock(T + 31 * MIN);
  await signInGoogle(w, "ada@example.com");
  check("Google OAuth sign-in (mock) => signed in", (await w.page.getByTestId("account-email").innerText()) === "ada@example.com");
  const promptVisible = await w.page.getByTestId("promotion-prompt").isVisible();
  check("anonymous promotion is explicit: 'Save this analysis to your account?'", promptVisible && (await w.page.getByTestId("visual-context").count()) === 0, "nothing copied before acceptance");
  await w.page.getByRole("button", { name: "Save to my account" }).click();
  await w.page.getByTestId("visual-context").waitFor();
  check("accepted promotion copies the trial into the account", (await w.page.locator("[data-testid^=chart-]").count()) === 3);

  // ── 5. DATA mode via OHLCV import (authenticated persistence) ───────────────────────────────────────
  const imported = w.page.waitForResponse((r) => r.url().endsWith("/api/ohlcv"));
  await w.page.locator('input[type=file][accept^="application/json"]').setInputFiles(OHLCV);
  await imported;
  await w.page.getByTestId("data-decision-value").waitFor();
  check("OHLCV fixture => CALL_SETUP (DATA mode)", (await w.page.getByTestId("data-decision-value").innerText()) === "CALL_SETUP");
  check("visual card still WAIT/BLOCKED after DATA", /WAIT|BLOCKED/.test(await w.permission()));
  await w.page.getByLabel(/Note on the latest analysis/).fill("Waiting for the retest to hold.");
  await w.page.getByRole("button", { name: "Add note" }).click();
  await w.page.getByText("Waiting for the retest to hold.").waitFor();
  check("journal note added", true);
  const userAState = await w.api("/api/workspace");
  const recordA = userAState.body.latestRecordId;
  await w.page.goto(`${BASE}/app/history`);
  const historyText = await w.page.locator("main").innerText();
  check("history lists VISUAL and DATA analyses", historyText.includes("VISUAL") && historyText.includes("DATA") && historyText.includes("TSLA"));
  check("authenticated persistence: promoted trial carries origin ANONYMOUS_TRIAL", historyText.includes("Saved trial"));

  // ── 6. Layout + accessibility ───────────────────────────────────────────────────────────────────────
  for (const page of ["/app", "/app/history"]) {
    await w.page.goto(`${BASE}${page}`);
    for (const width of [1440, 1280, 1024, 768, 430, 390]) {
      await w.page.setViewportSize({ width, height: 900 });
      const overflow = await w.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(`no horizontal overflow ${page} @${width}`, overflow <= 0, overflow > 0 ? `${overflow}px` : "");
    }
  }
  await w.page.setViewportSize({ width: 1440, height: 900 });
  const a11yOf = () =>
    w.page.evaluate(() => {
      const problems = [];
      if (!document.documentElement.lang) problems.push("html lang missing");
      if (document.querySelectorAll("h1").length !== 1) problems.push(`h1 count ${document.querySelectorAll("h1").length}`);
      if (!document.querySelector("main")) problems.push("no main landmark");
      if (!document.querySelector('a[href="#main"], a[href="#content"]')) problems.push("no skip link");
      for (const el of document.querySelectorAll("input, select, textarea")) {
        const labelled = (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.getAttribute("aria-label") || el.closest("label");
        if (!labelled && el.type !== "hidden") problems.push(`unlabelled ${el.tagName.toLowerCase()}#${el.id}`);
      }
      for (const b of document.querySelectorAll("button, a[href]")) if (!(b.textContent || "").trim() && !b.getAttribute("aria-label")) problems.push(`unnamed ${b.tagName.toLowerCase()}`);
      for (const i of document.querySelectorAll("img")) if (!i.hasAttribute("alt")) problems.push("img without alt");
      return problems;
    });
  await w.page.goto(`${BASE}/app`);
  const a11y = await a11yOf();
  check("accessibility basics", a11y.length === 0, a11y.join("; "));
  check("no browser console errors", w.errors.length === 0, w.errors.slice(0, 3).join(" | "));

  // ── 7. Magic link (mock) + VISUAL → DATA handoff via the provider ───────────────────────────────────
  const b = await workspace(END - 5 * MIN);
  await signInMagicLink(b, "bea@example.com");
  check("magic-link sign-in (mock) => signed in", (await b.page.getByTestId("account-email").innerText()) === "bea@example.com");
  await b.upload("tsla-5m-bull", END - 5 * MIN);
  check("authenticated upload => VISUAL ANALYSIS first", (await b.page.getByTestId("evidence-mode").getAttribute("data-mode")) === "VISUAL");
  await b.clock(END);
  const good = await connect(b);
  check("provider good path => DATA VERIFIED", good.status === "DATA_VERIFIED", good.text);
  check("visual → data handoff: DATA decision from verified data (CALL_SETUP)", (await b.page.getByTestId("data-decision-value").innerText()) === "CALL_SETUP");
  const banner = await b.page.getByTestId("evidence-mode").innerText();
  check("mode transition visible: DATA VERIFIED · deterministic engine active", /DATA VERIFIED[\s\S]*Deterministic Klynge engine active/.test(banner) && (await b.page.getByTestId("evidence-transition").isVisible()));
  check("provenance shown (provider, provider symbol, latest bar)", /SPX[\s\S]*mock I:SPX/.test(await b.page.getByTestId("data-provenance").innerText()));
  const opt = await b.page.getByTestId("options-state").innerText();
  check("options remain downstream (no chain => not eligible; setup unchanged)", !/: ELIGIBLE/.test(opt) && (await b.page.getByTestId("data-decision-value").innerText()) === "CALL_SETUP", opt);
  const alertsBefore = (await b.api("/api/workspace")).body.alerts.length;
  const again = await connect(b);
  check("same market state => unchanged (idempotent)", again.status === "UNCHANGED", again.text);
  check("alert idempotency: no duplicate alerts on reprocessing", (await b.api("/api/workspace")).body.alerts.length === alertsBefore, String(alertsBefore));

  // ── 8. Cross-user denial (ownership is server-derived; body/query tenant ids ignored) ────────────────
  const bHistory = await b.api("/api/history");
  check("cross-user denial: B never sees A's history", bHistory.status === 200 && bHistory.body.every((r) => r.recordId !== recordA));
  const forged = await b.api("/api/journal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recordId: recordA, note: "write into A", tenantId: "ignored", userId: "ignored" }) });
  check("cross-user denial: B cannot annotate A's record, even naming A's ids", forged.status === 404, String(forged.status));
  const bByQuery = await b.api(`/api/history?tenantId=${encodeURIComponent("anything")}`);
  check("query-parameter ownership ignored", bByQuery.status === 200 && bByQuery.body.every((r) => r.recordId !== recordA));

  // ── 9. Provider failure paths (offline scenarios) ───────────────────────────────────────────────────
  for (const [scenario, expected, text] of [["stale", "BLOCKED", /stale/i], ["missing-bar", "BLOCKED", /missing bars/i], ["outage", "BLOCKED", /unavailable/i]]) {
    await b.scenario(scenario);
    const r = await connect(b, "TSLA");
    check(`provider ${scenario} path => ${expected}`, r.status === expected && text.test(r.text), r.text.replace(/\s+/g, " "));
  }
  await b.scenario(null);

  // ── 10. Runtime restart: durable state resumes; previous decision restored ──────────────────────────
  await stopServer();
  await startServer();
  await b.clock(END + 10 * MIN);
  await b.page.goto(`${BASE}/app`);
  check("after restart: persisted DATA decision still shown", (await b.page.getByTestId("data-decision-value").innerText()) === "CALL_SETUP");
  const resumed = await connect(b, "TSLA");
  check("runtime restart => previous decision restored, no blank state", resumed.status === "UNCHANGED" && /previous decision restored/i.test(resumed.text), resumed.text);
  check("signed-in session survives restart (verified, not re-created)", (await b.page.getByTestId("account-email").innerText()) === "bea@example.com");
  check("no browser console errors (data journeys)", b.errors.length === 0, b.errors.slice(0, 3).join(" | "));
  await b.page.goto(`${BASE}/sign-in`);
  for (const width of [1440, 390]) {
    await b.page.setViewportSize({ width, height: 900 });
    const overflow = await b.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`no horizontal overflow /sign-in @${width}`, overflow <= 0, overflow > 0 ? `${overflow}px` : "");
  }
  await w.context.close();
  await b.context.close();

  // ── 10b. Production-readiness journeys (Batches 51–60) ─────────────────────────────────────────────
  const headersRes = await fetch(`${BASE}/app`);
  const csp = headersRes.headers.get("content-security-policy") ?? "";
  check("security headers: CSP, frame-ancestors none, nosniff, X-Frame-Options DENY", /default-src 'self'/.test(csp) && /frame-ancestors 'none'/.test(csp) && headersRes.headers.get("x-content-type-options") === "nosniff" && headersRes.headers.get("x-frame-options") === "DENY");
  const csrf1 = await fetch(`${BASE}/api/journal`, { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: "{}" });
  const csrf2 = await fetch(`${BASE}/api/settings`, { method: "POST", headers: { "sec-fetch-site": "cross-site", "content-type": "application/json" }, body: "{}" });
  check("CSRF: cross-origin / cross-site state changes rejected (403)", csrf1.status === 403 && csrf2.status === 403, `${csrf1.status},${csrf2.status}`);
  const health = await (await fetch(`${BASE}/api/health`)).json();
  check("public health probe exposes nothing but liveness", JSON.stringify(health) === '{"status":"ok"}');

  const c = await workspace(END - 5 * MIN);
  await signInGoogle(c, "cy@example.com");
  await c.page.goto(`${BASE}/app/settings`);
  await c.page.getByLabel("Allowed instruments (comma separated)").fill("NVDA");
  await c.page.getByLabel(/Email me at my verified address/).check();
  await c.page.getByLabel("Minimum importance").selectOption("INFO");
  await c.page.getByRole("button", { name: "Save settings" }).click();
  await c.page.getByTestId("settings-saved").waitFor();
  check("risk preferences + email opt-in saved (verified address only)", (await c.page.getByText("(cy@example.com)").count()) === 1);
  await c.page.goto(`${BASE}/app`);
  await c.upload("tsla-5m-bull", END - 5 * MIN);
  await c.clock(END);
  await connect(c);
  check("policy veto precedence: engine CALL_SETUP unchanged, user policy marks it outside limits", (await c.page.getByTestId("data-decision-value").innerText()) === "CALL_SETUP" && (await c.page.getByTestId("user-policy").getAttribute("data-within")) === "false" && /not in your instrument list/.test(await c.page.getByTestId("user-policy").innerText()));
  const mails = (await c.api(`/api/test/emails?to=${encodeURIComponent("cy@example.com")}`)).body ?? [];
  check("email notification delivered once per alert, sanitized (no prices/thresholds)", mails.length >= 1 && mails.some((m) => /CALL SETUP/.test(m.subject)) && mails.every((m) => !/\d+\.\d{2,}|ATR|reward/i.test(m.subject + m.text)) && new Set(mails.map((m) => m.subject)).size === mails.length, String(mails.length));
  await connect(c);
  check("notification idempotency: reprocessing sends nothing new", ((await c.api(`/api/test/emails?to=${encodeURIComponent("cy@example.com")}`)).body ?? []).length === mails.length);
  await c.page.goto(`${BASE}/app/status`);
  const statusText = await c.page.locator("main").innerText();
  check("operational status: provider health, freshness, delivery, audit", /Market data/i.test(statusText) && /TSLA: /.test(statusText) && /Delivered [1-9]/.test(statusText) && /data\.connected/.test(statusText) && /auth\.sign_in/.test(statusText), statusText.replace(/\s+/g, " ").slice(0, 600));
  for (const page of ["/app/settings", "/app/status"]) {
    await c.page.goto(`${BASE}${page}`);
    for (const width of [1440, 390]) {
      await c.page.setViewportSize({ width, height: 900 });
      const overflow = await c.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(`no horizontal overflow ${page} @${width}`, overflow <= 0, overflow > 0 ? `${overflow}px` : "");
    }
    await c.page.setViewportSize({ width: 1440, height: 900 });
    const pa = await c.page.evaluate(() => [...document.querySelectorAll("input, select, textarea")].filter((el) => !(el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) && !el.closest("label") && el.type !== "hidden").length);
    check(`accessibility basics ${page} (labelled controls)`, pa === 0, String(pa));
  }
  const stolen = (await c.context.cookies()).find((k) => k.name === "klynge_mock_session")?.value;
  await c.page.goto(`${BASE}/app`);
  await c.page.getByRole("button", { name: "Sign out" }).click();
  await c.page.waitForURL(/\/app/);
  const replay = await fetch(`${BASE}/api/history`, { headers: { cookie: `klynge_mock_session=${stolen}; klynge_session=${crypto.randomUUID()}; klynge_trial=${crypto.randomUUID()}` } });
  check("sign-out revokes the session: a copied cookie no longer authenticates", replay.status === 401, String(replay.status));
  check("no browser console errors (production journeys)", c.errors.length === 0, c.errors.slice(0, 3).join(" | "));
  await c.context.close();

  // ── 15. Pilot certification journeys (Batches 61–70; full matrix in docs/certification/pilot-readiness-v1.md) ──
  const d = await workspace(END - 5 * MIN);
  await d.page.goto(`${BASE}/app`);
  check("J68: persistent risk disclosure banner (not financial advice; screenshots are visual evidence only)", (await d.page.getByTestId("risk-banner").isVisible()) && /not financial advice[\s\S]*visual evidence only/.test(await d.page.getByTestId("risk-banner").innerText()));
  await signInGoogle(d, "dee@example.com");
  await d.page.goto(`${BASE}/app/settings`);
  await d.page.getByLabel(/Email me at my verified address/).check();
  await d.page.getByLabel("Minimum importance").selectOption("INFO");
  await d.page.getByRole("button", { name: "Save settings" }).click();
  await d.page.getByTestId("settings-saved").waitFor();
  await d.page.goto(`${BASE}/app`);
  await d.upload("tsla-5m-bull", END - 5 * MIN);
  await d.clock(END);
  const deeMails = async () => ((await d.api(`/api/test/emails?to=${encodeURIComponent("dee@example.com")}`)).body ?? []).length;
  const deeStatus = async () => JSON.stringify((await d.api("/api/status")).body?.notifications ?? null);
  const sentBefore = await deeMails();
  // The provider fails exactly one send during this connect (inline delivery); that item must wait for the worker.
  const injected = await d.api("/api/test/emails", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ failNext: 1 }) });
  await connect(d);
  const pendingBefore = await deeStatus();
  const sentAfterConnect = await deeMails();
  check("J10: transient email outage => failed item kept PENDING for retry (others delivered)", injected.status === 200 && /"pending":1/.test(pendingBefore), pendingBefore);
  const cron = (now, auth = `Bearer ${CRON}`) => fetch(`${BASE}/api/cron/notifications`, { method: "POST", headers: { authorization: auth, "x-klynge-now": String(now) } });
  const noAuth = await cron(END + 2 * MIN, "Bearer wrong-secret-wrong-secret-wrong-secret-00");
  check("J10: worker endpoint requires the server-only cron secret (401)", noAuth.status === 401, String(noAuth.status));
  const early = await (await cron(END + 30 * 1000)).json();
  check("J10: retry respects backoff (not due before 60 s)", early.delivered === 0, JSON.stringify(early));
  const run1 = await (await cron(END + 2 * MIN)).json();
  const run2 = await (await cron(END + 3 * MIN)).json();
  check("J10: alert → worker → delivered after retry, exactly once", sentAfterConnect > sentBefore && run1.delivered === 1 && run2.delivered === 0 && (await deeMails()) === sentAfterConnect + 1, `${JSON.stringify(run1)} ${JSON.stringify(run2)} ${await deeStatus()}`);
  const opsDenied = [await d.api("/api/admin/ops"), await d.api("/api/admin/ops", { headers: { "x-klynge-role": "admin", "x-klynge-admin": "1" } }), await d.api("/api/admin/ops/recover", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: "admin", tenantId: "x" }) })];
  check("J12: non-operators cannot reach operator APIs, even with forged role headers/body (404)", opsDenied.every((r) => r.status === 404), opsDenied.map((r) => r.status).join(","));
  const opsPage = await d.page.goto(`${BASE}/app/ops`);
  check("J12: operator dashboard is not disclosed to regular users (404)", opsPage?.status() === 404, String(opsPage?.status()));
  check("no browser console errors (pilot journeys, user)", d.errors.filter((e) => !/404/.test(e)).length === 0, d.errors.slice(0, 3).join(" | "));
  await d.context.close();

  const o = await workspace(END + 4 * MIN);
  await signInGoogle(o, "ops@example.com");
  await o.page.goto(`${BASE}/app/ops`);
  const opsText = await o.page.locator("main").innerText();
  const panels = await Promise.all(["ops-status", "ops-incidents", "ops-providers", "ops-sessions", "ops-delivery", "ops-ingestion", "ops-audit"].map((id) => o.page.getByTestId(id).count()));
  check("J69: operator dashboard shows status, providers, sessions, delivery, ingestion, audit counts", panels.every((n) => n === 1) && (await o.page.getByTestId("ops-delivery").innerText()).match(/Delivered [1-9]/) !== null && /worker runs [1-9]/.test(await o.page.getByTestId("ops-delivery").innerText()), opsText.replace(/\s+/g, " ").slice(0, 400));
  check("J69: operator view is aggregate-only (no user emails or ids)", !/(ada|bea|cy|dee)@example\.com/.test(opsText) && !/[0-9a-f]{8}-[0-9a-f]{4}-/.test(opsText));
  const opsJson = await o.api("/api/admin/ops");
  check("J69: ops API returns aggregates without PII, credentials or engine internals", opsJson.status === 200 && !/@example\.com|secret|apiKey|SERVICE_ROLE|minimumRewardRiskRatio|atrTolerance/i.test(JSON.stringify(opsJson.body)) && typeof opsJson.body.sessions.dataRecords === "number", String(opsJson.status));
  const recover = await o.api("/api/admin/ops/recover", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  check("J69: deterministic recovery available to operators (idempotent, audited)", recover.status === 200 && recover.body.quarantined === 0, JSON.stringify(recover.body));
  for (const width of [1440, 390]) {
    await o.page.setViewportSize({ width, height: 900 });
    const overflow = await o.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`no horizontal overflow /app/ops @${width}`, overflow <= 0, overflow > 0 ? `${overflow}px` : "");
  }
  check("no browser console errors (operator)", o.errors.length === 0, o.errors.slice(0, 3).join(" | "));
  await o.context.close();

  // ── 11. Skewed chart set => BLOCKED (anonymous) ─────────────────────────────────────────────────────
  const s = await workspace(T);
  await s.upload("tsla-5m-bull", T);
  await s.upload("spx-5m-bull", T + MIN);
  await s.upload("mnq-5m-bull", T + 10 * MIN);
  await s.page.getByTestId("visual-permission").filter({ hasText: "BLOCKED" }).waitFor();
  check("skewed chart set => BLOCKED", (await s.permission()).includes("BLOCKED"));
  await s.context.close();

  // ── 12. Low confidence => NOT_VERIFIED; broker screenshot does not leak account text ───────────────
  const n = await workspace(T);
  await n.upload("nvda-5m-ambiguous", T);
  await n.page.locator("[data-testid=chart-TARGET] tr[data-field=structure] [data-status]").waitFor();
  check("low-confidence structure => NOT_VERIFIED", (await n.status("TARGET", "structure")) === "NOT_VERIFIED");
  await n.context.close();
  const bb = await workspace(T);
  await bb.upload("broker-balance-tsla", T);
  check("broker account text not echoed in UI", !/4471|12,345/.test(await bb.page.locator("main").innerText()));
  await bb.context.close();

  // ── 13. API hardening ───────────────────────────────────────────────────────────────────────────────
  const fd = new FormData();
  fd.set("chart", new Blob(["<svg/>"], { type: "image/png" }), "x.png");
  const bad = await fetch(`${BASE}/api/charts`, { method: "POST", body: fd });
  check("spoofed image type rejected (415)", bad.status === 415, String(bad.status));
  const forgedCookie = await fetch(`${BASE}/api/history`, { headers: { cookie: `klynge_mock_session=${Buffer.from(JSON.stringify({ sub: "x" })).toString("base64url")}.AAAA; klynge_session=${crypto.randomUUID()}; klynge_trial=${crypto.randomUUID()}` } });
  check("forged auth cookie is not a user (401)", forgedCookie.status === 401, String(forgedCookie.status));
  const openRedirect = await fetch(`${BASE}/auth/callback?next=${encodeURIComponent("https://evil.example")}&code=bad`, { redirect: "manual" });
  check("auth callback never redirects off-site", !String(openRedirect.headers.get("location")).includes("evil.example"), openRedirect.headers.get("location") ?? "");
} catch (e) {
  check("e2e run", false, e.stack ?? String(e));
} finally {
  await browser.close();
  await stopServer();
}

// ── 14. Log hygiene: no image bytes, account text, auth tokens, emails or secrets ─────────────────────
const png = readFileSync(img("broker-balance-tsla")).toString("base64");
const leaks = ["iVBORw0KGgo", png.slice(200, 260), "4471-0098", "data:image/", "eyJ", "e2e-only-secret", "ada@example.com", "bea@example.com", "cy@example.com", "dee@example.com", "ops@example.com", "e2e-cron-secret", "service_role"].filter((m) => logs.includes(m));
check("server logs contain no image data or account text", leaks.length === 0, leaks.join(", "));
rmSync(STATE_DIR, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
console.log(`\ne2e: ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
