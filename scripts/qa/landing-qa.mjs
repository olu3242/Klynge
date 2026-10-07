/**
 * Landing QA (requires `node scripts/build.mjs` first). Uses the pre-installed Chromium.
 * Checks: responsive overflow, console/page errors, failed requests, images + alt, links/anchors,
 * favicon, downloadable kit, mobile nav, keyboard focus, FAQ, contrast, reduced motion, HTML sanity.
 * Screenshots are written to QA_OUT (default: build/qa).
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { startServer } from "../serve.mjs";

const WIDTHS = [1440, 1280, 1024, 768, 430, 390];
const OUT = process.env.QA_OUT ?? join(process.cwd(), "build", "qa");
mkdirSync(OUT, { recursive: true });

const failures = [];
const fail = (msg) => failures.push(msg);
const server = await startServer(0);
const BASE = `http://localhost:${server.address().port}/`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });

async function openPage(width, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, ...opts });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => errors.push(`requestfailed: ${r.url()}`));
  page.on("response", (r) => r.status() >= 400 && errors.push(`HTTP ${r.status()}: ${r.url()}`));
  await page.goto(BASE, { waitUntil: "networkidle" });
  return { ctx, page, errors };
}

// ---------- Responsive pass ----------
for (const width of WIDTHS) {
  const { ctx, page, errors } = await openPage(width);
  const tag = `[${width}]`;
  // Reveal everything so full-page screenshots show final state.
  await page.evaluate(() => document.querySelectorAll(".reveal").forEach((el) => el.classList.add("is-visible")));
  const overflow = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const offenders = [...document.querySelectorAll("body *")]
      .filter((el) => el.getBoundingClientRect().right > vw + 1 && getComputedStyle(el).position !== "fixed")
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join(".")}`);
    return { scroll: document.documentElement.scrollWidth, vw, offenders };
  });
  if (overflow.scroll > overflow.vw) fail(`${tag} horizontal overflow ${overflow.scroll}>${overflow.vw}: ${overflow.offenders.join(", ")}`);
  else if (overflow.offenders.length) fail(`${tag} elements exceed viewport: ${overflow.offenders.join(", ")}`);

  const toggleVisible = await page.locator(".nav-toggle").isVisible();
  if (width < 1024 && !toggleVisible) fail(`${tag} mobile nav toggle not visible`);
  if (width >= 1024 && toggleVisible) fail(`${tag} nav toggle visible on desktop`);
  if (width < 1024) {
    if (await page.locator(".nav-links").isVisible()) fail(`${tag} mobile menu visible before toggle`);
    await page.click(".nav-toggle");
    if (!(await page.locator(".nav-links").isVisible())) fail(`${tag} mobile menu did not open`);
    if ((await page.getAttribute(".nav-toggle", "aria-expanded")) !== "true") fail(`${tag} aria-expanded not updated`);
    await page.keyboard.press("Escape");
    if (await page.locator(".nav-links").isVisible()) fail(`${tag} Escape did not close menu`);
  }
  await page.screenshot({ path: join(OUT, `landing-${width}.png`), fullPage: true });
  errors.forEach((e) => fail(`${tag} ${e}`));
  await ctx.close();
}

// ---------- Content / a11y pass (desktop) ----------
{
  const { ctx, page, errors } = await openPage(1280);

  const imgs = await page.evaluate(() => [...document.images].map((i) => ({ src: i.getAttribute("src"), ok: i.complete && i.naturalWidth > 0, alt: i.getAttribute("alt") })));
  for (const i of imgs) {
    if (!i.ok) fail(`image failed to load: ${i.src}`);
    if (i.alt === null) fail(`image missing alt attribute: ${i.src}`);
  }

  const links = await page.evaluate(() => [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")));
  for (const href of new Set(links)) {
    if (href === "#" || href === "") fail(`placeholder link "${href}"`);
    else if (href.startsWith("#")) {
      if (!(await page.locator(href).count())) fail(`broken anchor ${href}`);
    } else if (!/^(https?:|mailto:)/.test(href)) {
      const res = await page.request.get(new URL(href, BASE).toString());
      if (!res.ok()) fail(`broken link ${href} (${res.status()})`);
    }
  }

  const icons = await page.evaluate(() => [...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')].map((l) => l.getAttribute("href")));
  if (!icons.some((h) => h.endsWith("favicon.svg"))) fail("favicon.svg not linked");
  for (const h of icons) {
    const res = await page.request.get(new URL(h, BASE).toString());
    if (!res.ok()) fail(`favicon ${h} -> ${res.status()}`);
  }

  for (const asset of ["downloadable/klynge-brand-kit.zip", "brand/asset-manifest.json", "downloadable/klynge-brand-kit/README.md", "images/social/klynge-og-1200x630.png"]) {
    const res = await page.request.get(BASE + asset);
    if (!res.ok() || (await res.body()).length === 0) fail(`downloadable asset unavailable: ${asset}`);
  }

  const dom = await page.evaluate(() => {
    const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    const h1 = document.querySelectorAll("h1").length;
    const landmarks = ["header", "main", "footer", "nav"].filter((t) => !document.querySelector(t));
    const unlabeledButtons = [...document.querySelectorAll("button")].filter((b) => !b.textContent.trim() && !b.getAttribute("aria-label")).length;
    return { dupes, h1, landmarks, unlabeledButtons, lang: document.documentElement.lang };
  });
  if (dom.dupes.length) fail(`duplicate ids: ${dom.dupes.join(", ")}`);
  if (dom.h1 !== 1) fail(`expected exactly one h1, found ${dom.h1}`);
  if (dom.landmarks.length) fail(`missing landmarks: ${dom.landmarks.join(", ")}`);
  if (dom.unlabeledButtons) fail(`${dom.unlabeledButtons} unlabeled buttons`);
  if (dom.lang !== "en") fail("html lang missing");

  // FAQ interaction (keyboard).
  const faqCount = await page.locator(".faq-list details").count();
  if (faqCount !== 6) fail(`expected 6 FAQ items, found ${faqCount}`);
  await page.locator(".faq-list summary").first().focus();
  await page.keyboard.press("Enter");
  if (!(await page.locator(".faq-list details").first().evaluate((d) => d.open))) fail("FAQ did not open via keyboard");

  // Keyboard navigation: skip link first, visible focus on every tab stop.
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.keyboard.press("Tab");
  if (!(await page.evaluate(() => document.activeElement?.classList.contains("skip")))) fail("first Tab stop is not the skip link");
  for (let i = 0; i < 25; i++) {
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      const cs = getComputedStyle(el);
      return { tag: el.tagName, outline: cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0 };
    });
    if (info.tag !== "BODY" && !info.outline) fail(`no visible focus indicator on ${info.tag} (tab stop ${i})`);
    await page.keyboard.press("Tab");
  }

  // Status must not rely on color alone: each chip/condition has a glyph AND a text label.
  const colorOnly = await page.evaluate(() => [...document.querySelectorAll(".chip, .cond, .state-value")].filter((el) => !el.querySelector("[aria-hidden]") || el.textContent.replace(/[^A-Za-z]/g, "").length < 3).length);
  if (colorOnly) fail(`${colorOnly} status indicators rely on color alone`);

  // Contrast: every text element vs its effective (composited) background.
  const lowContrast = await page.evaluate(() => {
    const parse = (c) => (c.match(/[\d.]+/g) || []).map(Number);
    const lum = ([r, g, b]) => {
      const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const blend = (top, bottom) => {
      const a = top[3] ?? 1;
      return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a));
    };
    const bgOf = (el) => {
      const layers = [];
      for (let n = el; n; n = n.parentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c.length && (c[3] ?? 1) > 0) layers.push(c);
        if ((c[3] ?? 0) === 1 || (c.length === 3)) break;
      }
      let out = [7, 10, 8];
      for (const l of layers.reverse()) out = blend(l, out);
      return out;
    };
    const bad = [];
    for (const el of document.querySelectorAll("body *")) {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own || el.closest("[aria-hidden='true']") || !el.getClientRects().length) continue;
      const cs = getComputedStyle(el);
      const fg = blend(parse(cs.color), bgOf(el));
      const L1 = lum(fg), L2 = lum(bgOf(el));
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const large = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && +cs.fontWeight >= 700);
      if (ratio < (large ? 3 : 4.5)) bad.push(`${el.tagName.toLowerCase()}.${[...el.classList].join(".")} "${el.textContent.trim().slice(0, 30)}" ${ratio.toFixed(2)}`);
    }
    return bad;
  });
  lowContrast.forEach((b) => fail(`low contrast: ${b}`));

  errors.forEach((e) => fail(`[content] ${e}`));
  await ctx.close();
}

// ---------- Reduced motion ----------
{
  const { ctx, page } = await openPage(390, { reducedMotion: "reduce" });
  const hidden = await page.evaluate(() => [...document.querySelectorAll(".step, .persona, .state-card")].filter((el) => getComputedStyle(el).opacity !== "1").length);
  if (hidden) fail(`reduced motion: ${hidden} elements not fully visible`);
  const smooth = await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior);
  if (smooth !== "auto") fail("reduced motion: smooth scrolling still enabled");
  await ctx.close();
}

// ---------- No-JS ----------
{
  const { ctx, page, errors } = await openPage(390, { javaScriptEnabled: false });
  if (!(await page.locator(".nav-links").isVisible())) fail("no-JS: navigation links not reachable");
  errors.forEach((e) => fail(`[no-js] ${e}`));
  await ctx.close();
}

await browser.close();
server.close();

if (failures.length) {
  console.error(`landing QA FAILED (${failures.length}):\n  ` + failures.join("\n  "));
  process.exit(1);
}
console.log(`landing QA OK — widths ${WIDTHS.join(", ")}; screenshots in ${OUT}`);
