import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { RecordedExtractor } from "./extraction/recorded-extractor.ts";
import { RateLimiter } from "./rate-limit.ts";
import type { RateLimitPolicy } from "./rate-limit.ts";
import { MemoryImageStore, MemorySessionStore } from "./store/memory-store.ts";
import type { ImageRetention } from "./store/types.ts";
import { MemoryTelemetrySink } from "./telemetry.ts";
import type { WorkspaceDeps } from "./workspace.ts";

/** Test-only helpers (never imported by routes). */
export const APP_ROOT = path.resolve(import.meta.dirname, "../..");
export const CORPUS = path.join(APP_ROOT, "test/corpus");
export const T = 1_780_000_000_000;
export const MIN = 60_000;

export const corpusImage = (id: string): Buffer => readFileSync(path.join(CORPUS, "images", `${id}.png`));

/** A valid PNG with no recording (the mock extractor returns nothing for it). */
export const unknownChart = (): Promise<Buffer> => sharp({ create: { width: 640, height: 360, channels: 3, background: "#203020" } }).png().toBuffer();

export function testDeps(opts: { retention?: ImageRetention; limit?: RateLimitPolicy } = {}): WorkspaceDeps & { telemetry: MemoryTelemetrySink; images: MemoryImageStore } {
  return {
    store: new MemorySessionStore(),
    images: new MemoryImageStore(opts.retention ?? "SESSION"),
    extractor: RecordedExtractor.fromFile("mock", path.join(CORPUS, "recorded/mock/index.json")),
    limiter: new RateLimiter(opts.limit ?? { capacity: 100, refillPerMs: 1 }),
    telemetry: new MemoryTelemetrySink(),
  };
}

// ── Batches 41–50 helpers ─────────────────────────────────────────────────────
import type { CookieJar, CookieOptions } from "./auth/types.ts";
import { mockMarketData } from "./market-data.ts";
import { TrialSessionStore } from "./store/trial-store.ts";

export const OHLCV_FIXTURE = path.join(APP_ROOT, "test/fixtures/ohlcv-call.json");
export const FIXTURE_END = (JSON.parse(readFileSync(OHLCV_FIXTURE, "utf8")) as { asOf: number }).asOf;
export const USER_A = "11111111-1111-4111-a111-111111111111";
export const USER_B = "22222222-2222-4222-a222-222222222222";
export const TRIAL_A = "trial:33333333-3333-4333-a333-333333333333";

/** Cookie jar over a Map (mirrors next/headers cookies() in tests). */
export function memoryJar(initial: Record<string, string> = {}): CookieJar & { store: Map<string, { value: string; options?: CookieOptions }> } {
  const store = new Map(Object.entries(initial).map(([k, v]) => [k, { value: v }]));
  return {
    store,
    get: (n) => store.get(n)?.value,
    getAll: () => [...store].map(([name, v]) => ({ name, value: v.value })),
    set: (n, value, options) => void store.set(n, { value, ...(options ? { options } : {}) }),
    delete: (n) => void store.delete(n),
  };
}

export function trialDeps(clock?: () => number) {
  return { ...testDeps(), store: new TrialSessionStore(clock ? { clock } : {}) };
}

export function marketDeps(base = testDeps()) {
  return { ...base, market: mockMarketData(OHLCV_FIXTURE) };
}
