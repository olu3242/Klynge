/**
 * End-to-end certification (run after `next build`): starts `next start` with the mock extractor and a test clock,
 * drives the real UI in Chromium, and asserts the visual/data boundary, layout, accessibility and log hygiene.
 * No network, no credentials, no model calls.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = Number(process.env.E2E_PORT ?? 3197);
const BASE = `http://127.0.0.1:${PORT}`;
const T = 1_780_000_000_000;
const MIN = 60_000;
const img = (id) => path.join(ROOT, "test/corpus/images", `${id}.png`);
const OHLCV = path.join(ROOT, "test/fixtures/ohlcv-call.json");
const DIRECTIONAL = /CALL_SETUP|PUT_SETUP|ELIGIBLE|CONDITIONS MET/;
const results = [];
let logs = "";

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const server = spawn(process.execPath, [path.join(ROOT, "node_modules/next/dist/bin/next"), "start", "-p", String(PORT), "-H", "127.0.0.1"], {
  cwd: ROOT,
  env: { ...process.env, KLYNGE_EXTRACTOR: "mock", KLYNGE_STORE: "memory", KLYNGE_IMAGE_RETENTION: "SESSION", KLYNGE_TEST_CLOCK: "1", NODE_ENV: "production" },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (d) => (logs += d));
server.stderr.on("data", (d) => (logs += d));

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${BASE}/app`, { redirect: "manual" })).status < 500) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server did not start:\n${logs}`);
}

const browser = await (async () => {
  await waitForServer();
  return chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
})();

async function workspace(now) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-klynge-now": String(now) } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${BASE}/app`);
  const clock = (t) => context.setExtraHTTPHeaders({ "x-klynge-now": String(t) });
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
  return { context, page, errors, clock, upload, label, permission, status };
}

try {
  // 1. Intake flow: TSLA → missing context → SPX + MNQ → BULLISH CONTEXT / WAIT.
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

  // 2. Confirmation (audited, USER_CONFIRMED).
  await w.page.locator("[data-testid=chart-TARGET]").getByRole("button", { name: "Confirm Symbol" }).click();
  await w.page.locator("[data-testid=chart-TARGET] tr[data-field=symbol] [data-status=USER_CONFIRMED]").waitFor();
  check("confirm field => USER_CONFIRMED", (await w.status("TARGET", "symbol")) === "USER_CONFIRMED");

  // 3. Stale set (re-evaluated 30 min later) => BLOCKED.
  await w.clock(T + 30 * MIN);
  await w.page.locator("[data-testid=chart-SPX]").getByRole("button", { name: "Confirm Symbol" }).click();
  await w.page.getByTestId("visual-permission").filter({ hasText: "BLOCKED" }).waitFor();
  check("stale chart set => BLOCKED", (await w.permission()).includes("BLOCKED"));

  // 4. DATA mode: OHLCV fixture => CALL_SETUP (only DATA can produce a setup).
  await w.clock(T + 31 * MIN);
  const imported = w.page.waitForResponse((r) => r.url().endsWith("/api/ohlcv"));
  await w.page.locator('input[type=file][accept^="application/json"]').setInputFiles(OHLCV);
  await imported;
  await w.page.getByTestId("data-decision-value").waitFor();
  check("OHLCV fixture => CALL_SETUP (DATA mode)", (await w.page.getByTestId("data-decision-value").innerText()) === "CALL_SETUP");
  check("visual card still WAIT/BLOCKED after DATA", /WAIT|BLOCKED/.test(await w.permission()));

  // 5. Journal + history.
  await w.page.getByLabel(/Note on the latest analysis/).fill("Waiting for the retest to hold.");
  await w.page.getByRole("button", { name: "Add note" }).click();
  await w.page.getByText("Waiting for the retest to hold.").waitFor();
  check("journal note added", true);
  await w.page.goto(`${BASE}/app/history`);
  const historyText = await w.page.locator("main").innerText();
  check("history lists VISUAL and DATA analyses", historyText.includes("VISUAL") && historyText.includes("DATA") && historyText.includes("TSLA"));

  // 6. Layout: no horizontal overflow at standard widths.
  for (const page of ["/app", "/app/history"]) {
    await w.page.goto(`${BASE}${page}`);
    for (const width of [1440, 1280, 1024, 768, 430, 390]) {
      await w.page.setViewportSize({ width, height: 900 });
      const overflow = await w.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(`no horizontal overflow ${page} @${width}`, overflow <= 0, overflow > 0 ? `${overflow}px` : "");
    }
  }

  // 7. Accessibility basics.
  await w.page.setViewportSize({ width: 1440, height: 900 });
  await w.page.goto(`${BASE}/app`);
  const a11y = await w.page.evaluate(() => {
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
  check("accessibility basics", a11y.length === 0, a11y.join("; "));
  check("no browser console errors", w.errors.length === 0, w.errors.slice(0, 3).join(" | "));
  await w.context.close();

  // 8. Skewed chart set => BLOCKED.
  const s = await workspace(T);
  await s.upload("tsla-5m-bull", T);
  await s.upload("spx-5m-bull", T + MIN);
  await s.upload("mnq-5m-bull", T + 10 * MIN);
  await s.page.getByTestId("visual-permission").filter({ hasText: "BLOCKED" }).waitFor();
  check("skewed chart set => BLOCKED", (await s.permission()).includes("BLOCKED"));
  await s.context.close();

  // 9. Low confidence => NOT_VERIFIED; broker screenshot does not leak account text into the UI.
  const n = await workspace(T);
  await n.upload("nvda-5m-ambiguous", T);
  await n.page.locator("[data-testid=chart-TARGET] tr[data-field=structure] [data-status]").waitFor();
  check("low-confidence structure => NOT_VERIFIED", (await n.status("TARGET", "structure")) === "NOT_VERIFIED");
  await n.context.close();
  const b = await workspace(T);
  await b.upload("broker-balance-tsla", T);
  check("broker account text not echoed in UI", !/4471|12,345/.test(await b.page.locator("main").innerText()));
  await b.context.close();

  // 10. API hardening.
  const bad = await fetch(`${BASE}/api/charts`, { method: "POST", headers: { cookie: "klynge_tenant=t; klynge_session=s" }, body: (() => { const f = new FormData(); f.set("chart", new Blob(["<svg/>"], { type: "image/png" }), "x.png"); return f; })() });
  check("spoofed image type rejected (415)", bad.status === 415, String(bad.status));
} catch (e) {
  check("e2e run", false, e.stack ?? String(e));
} finally {
  await browser.close();
  server.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 300));
}

// 11. Log hygiene: no image bytes, no account text, no raw tenant ids.
const png = readFileSync(img("broker-balance-tsla")).toString("base64");
const leaks = ["iVBORw0KGgo", png.slice(200, 260), "4471-0098", "data:image/"].filter((m) => logs.includes(m));
check("server logs contain no image data or account text", leaks.length === 0, leaks.join(", "));

const failed = results.filter((r) => !r.ok);
console.log(`\ne2e: ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
