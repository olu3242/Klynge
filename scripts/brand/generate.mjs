/**
 * Deterministic Klynge brand pipeline.
 *   node scripts/brand/generate.mjs          -> write SVG/CSS/JSON/README, render PNGs, build kit + zip
 *   node scripts/brand/generate.mjs --check  -> verify committed text assets match the source of truth
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import * as T from "./templates.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHECK = process.argv.includes("--check");
const tokens = JSON.parse(readFileSync(join(ROOT, "src/brand/tokens.json"), "utf8"));
const VERSION = tokens.version;
const PUB = join(ROOT, "public");
const KIT = join(PUB, "downloadable/klynge-brand-kit");

/** Every vector asset: [path under public/, svg, manifest metadata]. */
const svgAssets = [
  ["brand/logo/klynge-logo-dark.svg", T.logoSvg(tokens, "dark"), { purpose: "Primary logo lockup (mark + wordmark)", theme: "dark", alt: "Klynge logo" }],
  ["brand/logo/klynge-logo-light.svg", T.logoSvg(tokens, "light"), { purpose: "Primary logo lockup (mark + wordmark)", theme: "light", alt: "Klynge logo" }],
  ["brand/logo/klynge-wordmark-dark.svg", T.wordmarkSvg(tokens, "dark"), { purpose: "Wordmark only", theme: "dark", alt: "Klynge" }],
  ["brand/logo/klynge-wordmark-light.svg", T.wordmarkSvg(tokens, "light"), { purpose: "Wordmark only", theme: "light", alt: "Klynge" }],
  ["brand/logo/klynge-icon-dark.svg", T.iconSvg(tokens, "dark"), { purpose: "App icon / avatar (dark tile)", theme: "dark", alt: "Klynge icon" }],
  ["brand/logo/klynge-icon-light.svg", T.iconSvg(tokens, "light"), { purpose: "App icon / avatar (light tile)", theme: "light", alt: "Klynge icon" }],
  ["brand/logo/favicon.svg", T.faviconSvg(tokens), { purpose: "Browser favicon", theme: "dark", alt: "Klynge" }],
  ["brand/klynge-palette.svg", T.paletteSvg(tokens), { purpose: "Palette swatch sheet", theme: "dark", alt: "Klynge color palette" }],
  ["images/landing/klynge-hero-backdrop.svg", T.heroBackdropSvg(tokens), { purpose: "Decorative landing hero backdrop", theme: "dark", alt: "" }],
  ["images/product/klynge-workspace-preview.svg", T.productPreviewSvg(tokens), { purpose: "Illustrative product preview (sample data)", theme: "dark", alt: "Illustrative Klynge workspace showing a WAIT state with elevated risk" }],
  ["images/social/klynge-og-1200x630.svg", T.ogImageSvg(tokens), { purpose: "Open Graph / link preview image", theme: "dark", alt: "Klynge — See the Market Before You Take Risk" }],
  ["images/social/klynge-banner-1500x500.svg", T.bannerSvg(tokens), { purpose: "Social profile banner", theme: "dark", alt: "Klynge — Market Risk Intelligence" }],
];

/** PNG renders: [path under public/, source svg path, width, height, transparent]. */
const pngAssets = [
  ["brand/png/klynge-icon-dark-16.png", "brand/logo/klynge-icon-dark.svg", 16, 16],
  ["brand/png/klynge-icon-dark-32.png", "brand/logo/klynge-icon-dark.svg", 32, 32],
  ["brand/png/apple-touch-icon.png", "brand/logo/klynge-icon-dark.svg", 180, 180],
  ["brand/png/klynge-icon-dark-192.png", "brand/logo/klynge-icon-dark.svg", 192, 192],
  ["brand/png/klynge-icon-dark-512.png", "brand/logo/klynge-icon-dark.svg", 512, 512],
  ["brand/png/klynge-icon-dark-1024.png", "brand/logo/klynge-icon-dark.svg", 1024, 1024],
  ["brand/png/klynge-icon-light-512.png", "brand/logo/klynge-icon-light.svg", 512, 512],
  ["brand/png/klynge-logo-dark-1200.png", "brand/logo/klynge-logo-dark.svg", 1200, null, true],
  ["brand/png/klynge-logo-light-1200.png", "brand/logo/klynge-logo-light.svg", 1200, null, true],
  ["brand/png/klynge-wordmark-dark-1200.png", "brand/logo/klynge-wordmark-dark.svg", 1200, null, true],
  ["brand/png/klynge-wordmark-light-1200.png", "brand/logo/klynge-wordmark-light.svg", 1200, null, true],
  ["brand/png/klynge-palette.png", "brand/klynge-palette.svg", 1200, null],
  ["images/social/klynge-og-1200x630.png", "images/social/klynge-og-1200x630.svg", 1200, 630],
  ["images/social/klynge-banner-1500x500.png", "images/social/klynge-banner-1500x500.svg", 1500, 500],
  ["images/social/klynge-avatar-800.png", "brand/logo/klynge-icon-dark.svg", 800, 800],
  ["images/product/klynge-workspace-preview.png", "images/product/klynge-workspace-preview.svg", 1920, 1200],
];

/** Brand-kit layout: kit path -> public source. */
const kitFiles = {
  "SVG/klynge-logo-dark.svg": "brand/logo/klynge-logo-dark.svg",
  "SVG/klynge-logo-light.svg": "brand/logo/klynge-logo-light.svg",
  "SVG/klynge-wordmark-dark.svg": "brand/logo/klynge-wordmark-dark.svg",
  "SVG/klynge-wordmark-light.svg": "brand/logo/klynge-wordmark-light.svg",
  "SVG/klynge-icon-dark.svg": "brand/logo/klynge-icon-dark.svg",
  "SVG/klynge-icon-light.svg": "brand/logo/klynge-icon-light.svg",
  "SVG/favicon.svg": "brand/logo/favicon.svg",
  "PNG/klynge-icon-dark-32.png": "brand/png/klynge-icon-dark-32.png",
  "PNG/klynge-icon-dark-192.png": "brand/png/klynge-icon-dark-192.png",
  "PNG/klynge-icon-dark-512.png": "brand/png/klynge-icon-dark-512.png",
  "PNG/klynge-icon-dark-1024.png": "brand/png/klynge-icon-dark-1024.png",
  "PNG/klynge-icon-light-512.png": "brand/png/klynge-icon-light-512.png",
  "PNG/klynge-logo-dark-1200.png": "brand/png/klynge-logo-dark-1200.png",
  "PNG/klynge-logo-light-1200.png": "brand/png/klynge-logo-light-1200.png",
  "PNG/klynge-wordmark-dark-1200.png": "brand/png/klynge-wordmark-dark-1200.png",
  "PNG/klynge-wordmark-light-1200.png": "brand/png/klynge-wordmark-light-1200.png",
  "Palette/klynge-palette.svg": "brand/klynge-palette.svg",
  "Palette/klynge-palette.png": "brand/png/klynge-palette.png",
  "Social/klynge-og-1200x630.png": "images/social/klynge-og-1200x630.png",
  "Social/klynge-og-1200x630.svg": "images/social/klynge-og-1200x630.svg",
  "Social/klynge-banner-1500x500.png": "images/social/klynge-banner-1500x500.png",
  "Social/klynge-banner-1500x500.svg": "images/social/klynge-banner-1500x500.svg",
  "Social/klynge-avatar-800.png": "images/social/klynge-avatar-800.png",
};

const paletteJson = JSON.stringify({ name: "Klynge", version: VERSION, color: tokens.color, colorExtended: Object.fromEntries(Object.entries(tokens.colorExtended).filter(([k]) => !k.startsWith("$"))) }, null, 2) + "\n";
const kitText = {
  "Palette/klynge-palette.json": paletteJson,
  "Palette/klynge-tokens.css": T.tokensCss(tokens),
  "README.md": kitReadme(),
};

function kitReadme() {
  const rows = Object.entries(tokens.color).map(([k, v]) => `| \`--klynge-${k}\` | \`${v}\` |`).join("\n");
  return `# Klynge Brand Kit — v${VERSION}

Official Klynge identity assets. Vector files are hand-built paths (no fonts required).

## Contents
- \`SVG/\` — logo lockup, wordmark, icon (dark + light), favicon
- \`PNG/\` — raster exports of the icon, logo and wordmark
- \`Social/\` — Open Graph image, profile banner, avatar
- \`Palette/\` — tokens (JSON + CSS) and a swatch sheet

## Themes
- **dark** — artwork for dark backgrounds (light letterforms, lime accent). Icon \`-dark\` uses a dark tile.
- **light** — artwork for light backgrounds (dark letterforms, deep-lime accent). Icon \`-light\` uses a light tile.

## The mark
A geometric **K**: a vertical stem (structure) and two arms that converge on a **decision node**, then branch.
It deliberately avoids currency symbols, candlesticks, bull/bear imagery, coins and profit arrows.

## Usage
- Clear space: at least the width of the stem on every side.
- Minimum size: icon 16px; logo lockup 96px wide.
- Do not recolor, stretch, rotate, add effects, or place the dark artwork on light backgrounds (or vice versa).
- Do not pair the brand with promises of profit or certain outcomes.

## Palette
| Token | Hex |
|---|---|
${rows}

Klynge is not financial advice. Trading involves substantial risk and you may lose 100% of the capital committed to a trade.
`;
}

function manifest() {
  const dims = (svg) => {
    const m = svg.match(/width="([\d.]+)" height="([\d.]+)"/);
    return m ? { width: +m[1], height: +m[2] } : null;
  };
  const svgMeta = Object.fromEntries(svgAssets.map(([p, svg, meta]) => [p, { svg, meta }]));
  const entries = [];
  for (const [p, svg, meta] of svgAssets) entries.push({ filename: p, format: "svg", ...meta, dimensions: dims(svg), version: VERSION });
  for (const [p, src, w, h] of pngAssets) {
    const s = svgMeta[src];
    const d = dims(s.svg);
    entries.push({ filename: p, format: "png", purpose: `Raster export of ${src.split("/").pop()}`, theme: s.meta.theme, alt: s.meta.alt, dimensions: { width: w, height: h ?? Math.round((w * d.height) / d.width) }, version: VERSION });
  }
  for (const k of Object.keys(kitText)) entries.push({ filename: `downloadable/klynge-brand-kit/${k}`, format: k.split(".").pop(), purpose: "Brand kit palette/documentation", theme: "n/a", alt: k.endsWith(".svg") ? "Klynge color palette" : "", dimensions: null, version: VERSION });
  entries.push({ filename: "downloadable/klynge-brand-kit.zip", format: "zip", purpose: "Complete downloadable brand kit", theme: "n/a", alt: "", dimensions: null, version: VERSION });
  return JSON.stringify({ name: "Klynge brand assets", version: VERSION, generatedBy: "scripts/brand/generate.mjs", themes: { dark: "artwork for dark backgrounds", light: "artwork for light backgrounds" }, assets: entries }, null, 2) + "\n";
}

const textOutputs = {
  [join(ROOT, "styles/tokens.css")]: T.tokensCss(tokens),
  [join(PUB, "brand/asset-manifest.json")]: manifest(),
  ...Object.fromEntries(svgAssets.map(([p, svg]) => [join(PUB, p), svg])),
  ...Object.fromEntries(Object.entries(kitText).map(([k, v]) => [join(KIT, k), v])),
  ...Object.fromEntries(Object.entries(kitFiles).filter(([, src]) => src.endsWith(".svg")).map(([k, src]) => [join(KIT, k), svgAssets.find(([p]) => p === src)[1]])),
};

if (CHECK) {
  const problems = [];
  for (const [file, content] of Object.entries(textOutputs)) {
    if (!existsSync(file)) problems.push(`missing ${relative(ROOT, file)}`);
    else if (readFileSync(file, "utf8") !== content) problems.push(`out of date ${relative(ROOT, file)}`);
  }
  for (const [p] of pngAssets) if (!existsSync(join(PUB, p))) problems.push(`missing public/${p}`);
  for (const k of Object.keys(kitFiles)) if (!existsSync(join(KIT, k))) problems.push(`missing kit ${k}`);
  if (!existsSync(join(PUB, "downloadable/klynge-brand-kit.zip"))) problems.push("missing brand kit zip");
  if (problems.length) {
    console.error("brand:check FAILED — run `npm run brand`\n  " + problems.join("\n  "));
    process.exit(1);
  }
  console.log(`brand:check OK (${Object.keys(textOutputs).length} text assets, ${pngAssets.length} PNGs)`);
  process.exit(0);
}

rmSync(KIT, { recursive: true, force: true });
for (const [file, content] of Object.entries(textOutputs)) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

// Render PNGs with headless Chromium.
const { chromium } = await import("playwright-core");
const browser = await chromium.launch(process.env.PLAYWRIGHT_BROWSERS_PATH ? {} : { executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() =>
  chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }),
);
const page = await browser.newPage();
for (const [p, src, w, h, transparent] of pngAssets) {
  const svg = svgAssets.find(([s]) => s === src)[1];
  const m = svg.match(/width="([\d.]+)" height="([\d.]+)"/);
  const height = h ?? Math.round((w * +m[2]) / +m[1]);
  await page.setViewportSize({ width: w, height });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace(/width="[\d.]+" height="[\d.]+"/, `width="${w}" height="${height}"`)}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  mkdirSync(dirname(join(PUB, p)), { recursive: true });
  await page.screenshot({ path: join(PUB, p), omitBackground: Boolean(transparent), clip: { x: 0, y: 0, width: w, height } });
}
await browser.close();

for (const [k, src] of Object.entries(kitFiles)) {
  mkdirSync(dirname(join(KIT, k)), { recursive: true });
  copyFileSync(join(PUB, src), join(KIT, k));
}
const zip = join(PUB, "downloadable/klynge-brand-kit.zip");
rmSync(zip, { force: true });
execFileSync("zip", ["-X", "-q", "-r", "../klynge-brand-kit.zip", "."], { cwd: KIT });
console.log(`brand: ${svgAssets.length} SVG, ${pngAssets.length} PNG, kit + zip written`);
