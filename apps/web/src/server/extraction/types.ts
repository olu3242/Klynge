import type { ChartRole, Timeframe } from "../engine-core.ts";
import type { ProcessedImage } from "../intake.ts";

export interface ExtractionHints {
  symbol?: string;
  timeframe?: Timeframe;
  role?: ChartRole;
}

export interface ExtractionResult {
  /** Untrusted raw observation (validated deterministically by the engine). null = nothing usable. */
  raw: unknown;
  provider: string;
  model?: string;
  /** Why extraction produced nothing (refusal, truncation, parse failure, missing recording). */
  failure?: string;
}

/** Provider-agnostic extractor. Hints are never sent as observations; they are reconciled afterwards. */
export interface ChartExtractor {
  readonly provider: string;
  extract(image: ProcessedImage, hints: ExtractionHints): Promise<ExtractionResult>;
}
