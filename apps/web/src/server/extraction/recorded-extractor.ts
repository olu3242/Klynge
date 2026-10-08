import { readFileSync } from "node:fs";
import type { ProcessedImage } from "../intake.ts";
import type { ChartExtractor, ExtractionResult } from "./types.ts";

export interface RecordingIndex {
  /** sha256 of processed image -> recorded raw extractor output. */
  [sha256: string]: { id: string; raw: unknown };
}

/**
 * Deterministic extractor that replays recorded outputs keyed by image hash. Used as the MockExtractor in tests
 * and e2e (CI never calls a model). Unknown images yield no observation (all fields become NOT_PROVIDED).
 */
export class RecordedExtractor implements ChartExtractor {
  readonly provider: string;
  private readonly index: RecordingIndex;
  constructor(provider: string, index: RecordingIndex) {
    this.provider = provider;
    this.index = index;
  }

  static fromFile(provider: string, path: string): RecordedExtractor {
    return new RecordedExtractor(provider, JSON.parse(readFileSync(path, "utf8")) as RecordingIndex);
  }

  async extract(image: ProcessedImage): Promise<ExtractionResult> {
    const hit = this.index[image.sha256];
    return hit ? { raw: hit.raw, provider: this.provider } : { raw: null, provider: this.provider, failure: "no recording for this image" };
  }
}
