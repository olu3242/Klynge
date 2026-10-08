import path from "node:path";
import { ClaudeChartExtractor } from "./claude-extractor.ts";
import { RecordedExtractor } from "./recorded-extractor.ts";
import type { ChartExtractor } from "./types.ts";

/** Recorded corpus location (mock extractor + accuracy harness). Override with KLYNGE_CORPUS_DIR. */
export const CORPUS_DIR = path.resolve(process.env.KLYNGE_CORPUS_DIR ?? path.join(process.cwd(), "test/corpus"));

/** Server-side Anthropic credentials: API key, auth token, or Workload Identity Federation (SDK-native). */
export function hasAnthropicCredentials(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const wif = Boolean(env.ANTHROPIC_FEDERATION_RULE_ID && env.ANTHROPIC_ORGANIZATION_ID && env.ANTHROPIC_SERVICE_ACCOUNT_ID && (env.ANTHROPIC_IDENTITY_TOKEN_FILE || env.ANTHROPIC_IDENTITY_TOKEN));
  return Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || wif);
}

/**
 * KLYNGE_EXTRACTOR=claude (server-only Anthropic credentials) | mock (recorded corpus responses).
 * Default is mock unless the deployment explicitly selects claude, so tests and CI never call a model.
 */
export function selectExtractor(env: Readonly<Record<string, string | undefined>> = process.env): ChartExtractor {
  const choice = env.KLYNGE_EXTRACTOR ?? "mock";
  if (choice === "claude") {
    if (!hasAnthropicCredentials(env)) throw new Error("KLYNGE_EXTRACTOR=claude requires Anthropic credentials (API key or WIF)");
    return new ClaudeChartExtractor();
  }
  return RecordedExtractor.fromFile("mock", path.join(CORPUS_DIR, "recorded/mock/index.json"));
}
