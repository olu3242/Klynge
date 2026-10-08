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
