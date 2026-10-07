/** SVG templates for every Klynge brand asset. Pure functions of tokens + geometry. */
import { markAt, wordmarkAt } from "./geometry.mjs";

const r = (n) => +n.toFixed(2);
const header = (w, h, label) =>
  label
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="${r(w)}" height="${r(h)}" viewBox="0 0 ${r(w)} ${r(h)}" role="img" aria-labelledby="t">\n  <title id="t">${label}</title>\n`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="${r(w)}" height="${r(h)}" viewBox="0 0 ${r(w)} ${r(h)}" aria-hidden="true">\n`;

/** Theme palette for artwork. "dark" = for dark backgrounds; "light" = for light backgrounds. */
export function themeColors(tokens, theme) {
  const c = tokens.color;
  const x = tokens.colorExtended;
  return theme === "dark"
    ? { fg: c.text, accent: c.lime, node: c["lime-soft"], tile: c.black, tileBorder: c.border }
    : { fg: c.black, accent: x["lime-deep"], node: x["lime-deep"], tile: x.paper, tileBorder: "#dfe4df" };
}

function markGroup(m, col) {
  return [
    `  <g id="klynge-mark">`,
    `    <path id="stem" d="${m.stem}" fill="${col.fg}"/>`,
    `    <path id="arm-upper" d="${m.upper}" fill="${col.accent}"/>`,
    `    <path id="arm-lower" d="${m.lower}" fill="${col.accent}"/>`,
    `    <path id="decision-node" d="${m.node}" fill="${col.node}"/>`,
    `  </g>`,
  ].join("\n");
}

function wordGroup(w, col) {
  const letters = w.letters.map((l) => l.d.map((d) => `    <path id="letter-${l.ch.toLowerCase()}" d="${d}" fill="${col.fg}"/>`).join("\n"));
  return [
    `  <g id="klynge-wordmark">`,
    `    <path id="letter-k-stem" d="${w.k.stem}" fill="${col.fg}"/>`,
    `    <path id="letter-k-upper" d="${w.k.upper}" fill="${col.fg}"/>`,
    `    <path id="letter-k-lower" d="${w.k.lower}" fill="${col.fg}"/>`,
    `    <path id="letter-k-node" d="${w.k.node}" fill="${col.accent}"/>`,
    ...letters,
    `  </g>`,
  ].join("\n");
}

export function iconSvg(tokens, theme, size = 512) {
  const col = themeColors(tokens, theme);
  const pad = size * 0.2;
  const m = markAt(0, 0, size - pad * 2);
  const mk = markAt((size - m.width) / 2, pad, size - pad * 2);
  return `${header(size, size, "Klynge icon")}  <rect width="${size}" height="${size}" rx="${r(size * 0.22)}" fill="${col.tile}"/>\n${markGroup(mk, col)}\n</svg>\n`;
}

export function faviconSvg(tokens) {
  const col = themeColors(tokens, "dark");
  const m0 = markAt(0, 0, 22);
  const m = markAt((32 - m0.width) / 2, 5, 22);
  return `${header(32, 32, "Klynge")}  <rect width="32" height="32" rx="7" fill="${col.tile}"/>\n${markGroup(m, col)}\n</svg>\n`;
}

export function wordmarkSvg(tokens, theme) {
  const col = themeColors(tokens, theme);
  const cap = 40;
  const w = wordmarkAt(0, 0, cap);
  return `${header(w.width, cap, "Klynge")}${wordGroup(w, col)}\n</svg>\n`;
}

export function logoSvg(tokens, theme) {
  const col = themeColors(tokens, theme);
  const markH = 64;
  const cap = 30;
  const m = markAt(0, 0, markH);
  const gap = 22;
  const w = wordmarkAt(m.width + gap, (markH - cap) / 2, cap);
  return `${header(m.width + gap + w.width, markH, "Klynge logo")}${markGroup(m, col)}\n${wordGroup(w, col)}\n</svg>\n`;
}

/** Decorative hero backdrop: converging structure lines. Purely aesthetic. */
export function heroBackdropSvg(tokens) {
  const c = tokens.color;
  const lines = [];
  for (let i = 0; i < 9; i++) {
    const y = 40 + i * 70;
    lines.push(`    <path d="M0 ${y}L760 320L1440 ${y}" stroke="${i === 4 ? c.lime : c.border}" stroke-opacity="${i === 4 ? 0.35 : 0.55}" fill="none"/>`);
  }
  return `${header(1440, 640, "")}  <g stroke-width="1">\n${lines.join("\n")}\n  </g>\n  <rect x="752" y="312" width="16" height="16" transform="rotate(45 760 320)" fill="${c.lime}" fill-opacity="0.5"/>\n</svg>\n`;
}

function txt(x, y, s, size, fill, weight = 500, extra = "", family = "Inter, system-ui, sans-serif") {
  return `  <text x="${x}" y="${y}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}"${extra}>${s}</text>`;
}

/** Illustrative product preview (generic states only — no internals). */
export function productPreviewSvg(tokens) {
  const c = tokens.color;
  const rows = [
    ["Context", "✓ met", c.success],
    ["Structure", "✓ met", c.success],
    ["Price action", "… pending", c.warning],
    ["Risk", "… pending", c.warning],
  ];
  const out = [
    `${header(960, 600, "Illustrative Klynge workspace showing a WAIT state with elevated risk")}  <rect width="960" height="600" rx="24" fill="${c.surface}"/>`,
    `  <rect x="0.5" y="0.5" width="959" height="599" rx="23.5" fill="none" stroke="${c.border}"/>`,
    txt(40, 64, "MARKET CONTEXT", 14, c["text-muted"], 600, ' letter-spacing="2"'),
    `  <rect x="40" y="82" width="118" height="34" rx="17" fill="${c.warning}" fill-opacity="0.14" stroke="${c.warning}" stroke-opacity="0.5"/>`,
    txt(60, 105, "CAUTIOUS", 15, c.warning, 700),
    txt(40, 196, "TSLA", 22, c["text-secondary"], 600),
    txt(40, 256, "$241.36", 54, c.text, 700),
    `  <rect x="40" y="300" width="400" height="120" rx="16" fill="${c["surface-elevated"]}" stroke="${c.border}"/>`,
    txt(64, 340, "CURRENT STATE", 13, c["text-muted"], 600, ' letter-spacing="2"'),
    txt(64, 392, "WAIT", 40, c.text, 800),
    `  <rect x="40" y="440" width="400" height="110" rx="16" fill="${c["surface-elevated"]}" stroke="${c.border}"/>`,
    txt(64, 480, "RISK", 13, c["text-muted"], 600, ' letter-spacing="2"'),
    txt(64, 526, "▲ ELEVATED", 30, c.danger, 800),
    `  <rect x="480" y="40" width="440" height="510" rx="16" fill="${c["surface-elevated"]}" stroke="${c.border}"/>`,
    txt(512, 88, "CONDITIONS", 13, c["text-muted"], 600, ' letter-spacing="2"'),
  ];
  rows.forEach(([label, state, col], i) => {
    const y = 150 + i * 90;
    out.push(`  <line x1="512" y1="${y + 30}" x2="888" y2="${y + 30}" stroke="${c.border}"/>`);
    out.push(txt(512, y, label, 22, c.text, 600));
    out.push(txt(888, y, state, 18, col, 700, ' text-anchor="end"'));
  });
  out.push(txt(512, 530, "Illustrative interface · sample data", 13, c["text-muted"], 500));
  out.push("</svg>\n");
  return out.join("\n");
}

export function ogImageSvg(tokens) {
  const c = tokens.color;
  const col = themeColors(tokens, "dark");
  const m = markAt(80, 80, 72);
  return [
    `${header(1200, 630, "Klynge — See the Market Before You Take Risk")}  <rect width="1200" height="630" fill="${c.black}"/>`,
    `  <path d="M640 0L1200 315L640 630" stroke="${c.border}" fill="none"/>`,
    `  <path d="M760 0L1200 315L760 630" stroke="${c.border}" fill="none"/>`,
    `  <path d="M880 0L1200 315L880 630" stroke="${c.lime}" stroke-opacity="0.4" fill="none"/>`,
    markGroup(m, col),
    txt(80, 250, "MARKET RISK INTELLIGENCE", 22, c.lime, 600, ' letter-spacing="4"'),
    txt(80, 330, "See the Market", 72, c.text, 800, ' letter-spacing="-1.5"'),
    txt(80, 410, "Before You Take Risk", 72, c.text, 800, ' letter-spacing="-1.5"'),
    txt(80, 548, "Klynge is not financial advice. Trading involves substantial risk.", 20, c["text-secondary"], 500),
    "</svg>\n",
  ].join("\n");
}

export function bannerSvg(tokens) {
  const c = tokens.color;
  const col = themeColors(tokens, "dark");
  const w = wordmarkAt(120, 210, 64);
  return [
    `${header(1500, 500, "Klynge banner")}  <rect width="1500" height="500" fill="${c.black}"/>`,
    `  <path d="M900 0L1500 250L900 500" stroke="${c.border}" fill="none"/>`,
    `  <path d="M1050 0L1500 250L1050 500" stroke="${c.lime}" stroke-opacity="0.4" fill="none"/>`,
    wordGroup(w, col),
    txt(120, 340, "Market Risk Intelligence", 30, c["text-secondary"], 500),
    "</svg>\n",
  ].join("\n");
}

export function paletteSvg(tokens) {
  const entries = Object.entries(tokens.color);
  const cols = 4;
  const cw = 280;
  const ch = 170;
  const h = Math.ceil(entries.length / cols) * ch + 120;
  const out = [`${header(cols * cw + 80, h, "Klynge color palette")}  <rect width="${cols * cw + 80}" height="${h}" fill="${tokens.color.black}"/>`];
  out.push(txt(40, 66, "Klynge — Canonical Palette", 26, tokens.color.text, 700));
  entries.forEach(([name, hex], i) => {
    const x = 40 + (i % cols) * cw;
    const y = 100 + Math.floor(i / cols) * ch;
    out.push(`  <rect x="${x}" y="${y}" width="${cw - 20}" height="96" rx="12" fill="${hex}" stroke="${tokens.color.border}"/>`);
    out.push(txt(x, y + 124, `--klynge-${name}`, 15, tokens.color.text, 600));
    out.push(txt(x, y + 146, hex, 14, tokens.color["text-secondary"], 500, "", "ui-monospace, monospace"));
  });
  out.push("</svg>\n");
  return out.join("\n");
}

export function tokensCss(tokens) {
  const lines = [
    "/* GENERATED by scripts/brand/generate.mjs from src/brand/tokens.json — do not edit by hand. */",
    ":root {",
    ...Object.entries(tokens.color).map(([k, v]) => `  --klynge-${k}: ${v};`),
    ...Object.entries(tokens.colorExtended).filter(([k]) => !k.startsWith("$")).map(([k, v]) => `  --klynge-${k}: ${v};`),
    ...Object.entries(tokens.radius).map(([k, v]) => `  --klynge-radius-${k}: ${v};`),
    ...Object.entries(tokens.font).map(([k, v]) => `  --klynge-font-${k}: ${v};`),
    ...Object.entries(tokens.motion).map(([k, v]) => `  --klynge-motion-${k}: ${v};`),
    "}",
    "",
  ];
  return lines.join("\n");
}
