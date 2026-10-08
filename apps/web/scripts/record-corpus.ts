/**
 * LIVE re-record (manual only — never part of tests/CI gates): runs the Claude extractor over every corpus image
 * and writes recorded/claude/<id>.json, then prints the accuracy report.
 * Credentials: ANTHROPIC_API_KEY, or Workload Identity Federation env vars (see .github/workflows/corpus-record.yml).
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { scoreCorpus } from "../src/server/accuracy.ts";
import { ClaudeChartExtractor } from "../src/server/extraction/claude-extractor.ts";
import { CORPUS_DIR, hasAnthropicCredentials } from "../src/server/extraction/select.ts";
import { processUpload } from "../src/server/intake.ts";

if (!process.argv.includes("--live")) {
  console.error("Refusing to call the model without --live (this spends API credits).");
  process.exit(2);
}
if (!hasAnthropicCredentials()) {
  console.error("No Anthropic credentials (ANTHROPIC_API_KEY or WIF env vars).");
  process.exit(2);
}
const extractor = new ClaudeChartExtractor();
const out = path.join(CORPUS_DIR, "recorded/claude");
mkdirSync(out, { recursive: true });
for (const file of readdirSync(path.join(CORPUS_DIR, "images")).filter((f) => f.endsWith(".png")).sort()) {
  const id = file.slice(0, -4);
  const image = await processUpload(readFileSync(path.join(CORPUS_DIR, "images", file)));
  const result = await extractor.extract(image, {});
  writeFileSync(path.join(out, `${id}.json`), JSON.stringify(result.raw ?? {}, null, 2) + "\n");
  console.log(`${id}: ${result.failure ?? "ok"} (${result.model ?? "?"})`);
}
console.log(JSON.stringify(scoreCorpus(CORPUS_DIR, "claude"), null, 2));
