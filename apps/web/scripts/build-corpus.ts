/**
 * Deterministic corpus builder (run: npm run corpus:build).
 *   images/<id>.png            synthetic chart screenshots (SVG → PNG)
 *   golden/<id>.json           ground truth per field (what a perfect reader would report)
 *   recorded/mock/<id>.json    SYNTHETIC mock recordings — hand-authored, deliberately imperfect, NOT model output
 *   recorded/mock/index.json   processed-image sha256 → recording (RecordedExtractor input)
 *   ../fixtures/ohlcv-call.json DATA-mode fixture (engine test feeds) for e2e
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { processUpload } from "../src/server/intake.ts";
import { bullTargetFeed, END, trendFeed } from "../../../src/klynge/mtf-test-fixtures.ts";

const ROOT = path.join(import.meta.dirname, "../test/corpus");
const W = 1280;
const H = 720;

interface Spec {
  id: string;
  symbol: string;
  timeframe: string;
  trend: 1 | -1 | 0;
  base: number;
  step: number;
  vwapOffset: number;
  ema: boolean;
  banner?: string;
}

const SPECS: Spec[] = [
  { id: "tsla-5m-bull", symbol: "TSLA", timeframe: "5M", trend: 1, base: 236, step: 0.22, vwapOffset: -2.2, ema: true },
  { id: "spx-5m-bull", symbol: "SPX", timeframe: "5M", trend: 1, base: 5210, step: 0.9, vwapOffset: -8, ema: false },
  { id: "mnq-5m-bull", symbol: "MNQ", timeframe: "5M", trend: 1, base: 18010, step: 3.1, vwapOffset: -30, ema: false },
  { id: "spx-5m-bear", symbol: "SPX", timeframe: "5M", trend: -1, base: 5240, step: 0.9, vwapOffset: 8, ema: false },
  { id: "tsla-5m-bear", symbol: "TSLA", timeframe: "5M", trend: -1, base: 446, step: 0.25, vwapOffset: 2.4, ema: true },
  { id: "nvda-5m-ambiguous", symbol: "NVDA", timeframe: "5M", trend: 0, base: 131, step: 0.05, vwapOffset: 0.1, ema: false },
  { id: "broker-balance-tsla", symbol: "TSLA", timeframe: "5M", trend: 1, base: 236, step: 0.22, vwapOffset: -2.2, ema: false, banner: "Account 4471-0098 · Balance $12,345.67" },
];

const wave = (i: number) => [0, 0.8, 1.4, 0.9, 0.2, -0.4][i % 6] as number;

function series(s: Spec) {
  const n = 48;
  return Array.from({ length: n }, (_, i) => {
    const c = s.base + s.trend * s.step * i * 4 + wave(i) * s.step * 6;
    const o = i === 0 ? c : s.base + s.trend * s.step * (i - 1) * 4 + wave(i - 1) * s.step * 6;
    return { o, c, h: Math.max(o, c) + s.step * 2, l: Math.min(o, c) - s.step * 2 };
  });
}

function svg(s: Spec): { svg: string; last: number; axis: { min: number; max: number } } {
  const bars = series(s);
  const lo = Math.min(...bars.map((b) => b.l)) - s.step * 6;
  const hi = Math.max(...bars.map((b) => b.h)) + s.step * 6;
  const y = (p: number) => 80 + ((hi - p) / (hi - lo)) * (H - 160);
  const x = (i: number) => 60 + i * ((W - 200) / bars.length);
  const bw = ((W - 200) / bars.length) * 0.6;
  const last = bars.at(-1)!.c;
  const vwap = bars.map((b, i) => `${x(i) + bw / 2},${y(b.c + s.vwapOffset)}`).join(" ");
  const ema = bars.map((b, i) => `${x(i) + bw / 2},${y(b.c - s.vwapOffset / 3)}`).join(" ");
  const ticks = Array.from({ length: 6 }, (_, k) => lo + ((hi - lo) * k) / 5);
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="Inter, DejaVu Sans, sans-serif">`,
    `<rect width="${W}" height="${H}" fill="#0f1310"/>`,
    `<text x="24" y="44" fill="#e8ece8" font-size="26" font-weight="700">${s.symbol} · ${s.timeframe}</text>`,
    s.banner ? `<text x="${W - 24}" y="44" text-anchor="end" fill="#e8ece8" font-size="18">${s.banner}</text>` : "",
    ...ticks.map((t) => `<text x="${W - 24}" y="${y(t) + 5}" text-anchor="end" fill="#8a948b" font-size="14">${t.toFixed(2)}</text>`),
    ...bars.map((b, i) => {
      const up = b.c >= b.o;
      const col = up ? "#31d17c" : "#ff5252";
      return `<line x1="${x(i) + bw / 2}" x2="${x(i) + bw / 2}" y1="${y(b.h)}" y2="${y(b.l)}" stroke="${col}"/><rect x="${x(i)}" y="${y(Math.max(b.o, b.c))}" width="${bw}" height="${Math.max(1, Math.abs(y(b.o) - y(b.c)))}" fill="${col}"/>`;
    }),
    `<polyline points="${vwap}" fill="none" stroke="#f5a623" stroke-width="2"/>`,
    `<text x="${x(bars.length - 1) + 24}" y="${y(bars.at(-1)!.c + s.vwapOffset) + 5}" fill="#f5a623" font-size="15">VWAP</text>`,
    s.ema ? `<polyline points="${ema}" fill="none" stroke="#5aa9ff" stroke-width="2"/><text x="24" y="74" fill="#5aa9ff" font-size="15">EMA 9</text>` : "",
    `<rect x="${W - 140}" y="${y(last) - 13}" width="116" height="26" fill="#9dff3f"/><text x="${W - 82}" y="${y(last) + 6}" text-anchor="middle" font-size="15" fill="#070a08">${last.toFixed(2)}</text>`,
    `</svg>`,
  ];
  return { svg: out.join(""), last, axis: { min: Number(ticks[0]!.toFixed(2)), max: Number(ticks[5]!.toFixed(2)) } };
}

type Field = { value: unknown; status: "OBSERVED" | "NOT_VISIBLE"; confidence: number; evidence: string };
const obs = (value: unknown, confidence: number, evidence: string): Field => ({ value, status: "OBSERVED", confidence, evidence });
const nv = (): Field => ({ value: null, status: "NOT_VISIBLE", confidence: 0.9, evidence: "not shown" });

function golden(s: Spec, last: number, axis: { min: number; max: number }) {
  const rel = s.trend > 0 ? "ABOVE" : s.trend < 0 ? "BELOW" : "AT";
  return {
    symbol: s.symbol,
    timeframe: "5m",
    lastPrice: Number(last.toFixed(2)),
    priceAxisRange: axis,
    vwapVisible: true,
    priceVsVwap: rel,
    emaRelation: s.ema ? { label: "EMA 9", relation: rel } : null,
    structure: s.trend > 0 ? "HH_HL" : s.trend < 0 ? "LH_LL" : "MIXED",
    levels: null,
    volumeVisibility: "NONE",
    chartTime: null,
  };
}

/** SYNTHETIC mock recording derived from golden with documented, deliberate imperfections. */
function mockRecording(id: string, g: ReturnType<typeof golden>): Record<string, Field> {
  const r: Record<string, Field> = {
    symbol: obs(g.symbol, 0.97, "ticker in title"),
    timeframe: obs(g.timeframe, 0.95, "interval in title"),
    lastPrice: obs(g.lastPrice, 0.92, "highlighted price tag"),
    priceAxisRange: obs(g.priceAxisRange, 0.9, "right axis labels"),
    vwapVisible: obs(true, 0.93, "line labelled VWAP"),
    priceVsVwap: obs(g.priceVsVwap, 0.88, "price relative to VWAP line"),
    emaRelation: g.emaRelation ? obs(g.emaRelation, 0.85, "line labelled EMA 9") : nv(),
    structure: obs(g.structure, 0.84, "swing sequence"),
    levels: nv(),
    volumeVisibility: obs("NONE", 0.9, "no volume pane"),
    chartTime: nv(),
  };
  if (id === "nvda-5m-ambiguous") r.structure = obs("HH_HL", 0.5, "unclear swings"); // low confidence => NOT_VERIFIED (and wrong)
  if (id === "mnq-5m-bull") r.lastPrice = obs(Number((g.lastPrice + 25).toFixed(2)), 0.91, "price tag (misread)"); // confident error
  if (id === "spx-5m-bear") (r as Record<string, unknown>).atr14 = obs(4.2, 0.9, "computed"); // unsupported field injection
  if (id === "tsla-5m-bear") r.structure = obs("MIXED", 0.86, "swing sequence (misjudged)"); // plausible confident error that passes validation
  return r;
}

async function main() {
  for (const d of ["images", "golden", "recorded/mock"]) mkdirSync(path.join(ROOT, d), { recursive: true });
  const index: Record<string, { id: string; raw: unknown }> = {};
  for (const s of SPECS) {
    const { svg: doc, last, axis } = svg(s);
    const png = await sharp(Buffer.from(doc)).png().toBuffer();
    writeFileSync(path.join(ROOT, "images", `${s.id}.png`), png);
    const g = golden(s, last, axis);
    writeFileSync(path.join(ROOT, "golden", `${s.id}.json`), JSON.stringify(g, null, 2) + "\n");
    const raw = mockRecording(s.id, g);
    writeFileSync(path.join(ROOT, "recorded/mock", `${s.id}.json`), JSON.stringify(raw, null, 2) + "\n");
    const processed = await processUpload(readFileSync(path.join(ROOT, "images", `${s.id}.png`)));
    index[processed.sha256] = { id: s.id, raw };
  }
  writeFileSync(path.join(ROOT, "recorded/mock/index.json"), JSON.stringify(index, null, 2) + "\n");
  writeFileSync(
    path.join(ROOT, "README.md"),
    "# Chart extraction corpus\n\nSynthetic chart screenshots with golden labels. `recorded/mock/` holds hand-authored, deliberately imperfect\n" +
      "recordings used by the MockExtractor. They are NOT model output. Real accuracy requires `npm run corpus:record`\n" +
      "(Anthropic credentials; manual only), which writes `recorded/claude/`.\n",
  );
  const fixture = {
    asOf: END,
    timeframePolicy: { macro: "1d", structure: "1h", setup: "15m", execution: "5m" },
    target: bullTargetFeed(),
    spx: trendFeed("SPX", 0.05, 5000),
    mnq: trendFeed("MNQ", 0.05, 18000),
  };
  writeFileSync(path.join(import.meta.dirname, "../test/fixtures/ohlcv-call.json"), JSON.stringify(fixture));
  console.log(`corpus: ${SPECS.length} images, golden + mock recordings, DATA fixture`);
}

await main();
