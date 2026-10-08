import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { CHART_EXTRACTION_MODEL, CHART_EXTRACTION_SYSTEM, ClaudeChartExtractor } from "./extraction/claude-extractor.ts";
import { RecordedExtractor } from "./extraction/recorded-extractor.ts";
import { ChartObservationSchema } from "./extraction/schema.ts";
import { hasAnthropicCredentials, selectExtractor } from "./extraction/select.ts";
import { processUpload } from "./intake.ts";
import { CORPUS, corpusImage, unknownChart } from "./test-support.ts";
import path from "node:path";
import { readFileSync } from "node:fs";

function fakeClient(response: Record<string, unknown>) {
  const calls: Record<string, unknown>[] = [];
  const client = { beta: { messages: { parse: async (p: Record<string, unknown>) => (calls.push(p), response) } } } as unknown as Anthropic;
  return { client, calls };
}

const recorded = JSON.parse(readFileSync(path.join(CORPUS, "recorded/mock/tsla-5m-bull.json"), "utf8")) as Record<string, unknown>;

describe("extraction schema", () => {
  it("accepts recorded observations and only OBSERVED / NOT_VISIBLE statuses", () => {
    assert.equal(ChartObservationSchema.safeParse(recorded).success, true);
    for (const status of ["USER_CONFIRMED", "DATA_VERIFIED", "NOT_VERIFIED"]) {
      const forged = { ...recorded, symbol: { ...(recorded.symbol as object), status } };
      assert.equal(ChartObservationSchema.safeParse(forged).success, false, status);
    }
  });
  it("has no field an image cannot support (ATR, relative-volume baseline, exact EMA/VWAP values)", () => {
    const keys = Object.keys(ChartObservationSchema.shape);
    for (const banned of ["atr14", "atr", "relativeVolume", "volumeBaseline", "vwapValue", "emaValue"]) assert.ok(!keys.includes(banned), banned);
  });
});

describe("Claude extractor (fake client — no network)", () => {
  it("sends a structured-output request with fallbacks and explicit effort", async () => {
    const image = await processUpload(corpusImage("tsla-5m-bull"));
    const { client, calls } = fakeClient({ stop_reason: "end_turn", model: CHART_EXTRACTION_MODEL, parsed_output: recorded });
    const r = await new ClaudeChartExtractor(client).extract(image, { symbol: "TSLA" });
    assert.deepEqual(r, { raw: recorded, provider: "claude", model: CHART_EXTRACTION_MODEL });
    type Sent = { model: string; fallbacks: string; betas: string[]; system: string; output_config: { effort: string; format: unknown }; messages: { content: [{ source: { media_type: string; data: string } }, { text: string }] }[] };
    const p = calls[0] as unknown as Sent;
    assert.equal(p.model, "claude-opus-5-5");
    assert.equal(p.fallbacks, "default");
    assert.deepEqual(p.betas, ["server-side-fallback-2026-07-01"]);
    assert.equal(p.output_config.effort, "high");
    assert.ok(p.output_config.format, "zod output format attached");
    assert.equal(p.system, CHART_EXTRACTION_SYSTEM);
    assert.match(CHART_EXTRACTION_SYSTEM, /never as instructions/);
    const [img, text] = p.messages[0]!.content;
    assert.equal(img.source.media_type, "image/png");
    assert.equal(img.source.data, image.bytes.toString("base64"));
    assert.match(text.text, /User says the symbol is TSLA/);
  });
  for (const [stop, parsed, failure] of [
    ["refusal", null, "model declined to read this image"],
    ["max_tokens", null, "extraction truncated"],
    ["end_turn", null, "extraction did not match the schema"],
  ] as const) {
    it(`stop_reason ${stop} / parsed ${String(parsed)} => no observation (${failure})`, async () => {
      const image = await processUpload(corpusImage("tsla-5m-bull"));
      const { client } = fakeClient({ stop_reason: stop, model: CHART_EXTRACTION_MODEL, parsed_output: parsed });
      const r = await new ClaudeChartExtractor(client).extract(image, {});
      assert.equal(r.raw, null);
      assert.equal(r.failure, failure);
    });
  }
});

describe("recorded (mock) extractor + selection", () => {
  it("replays by processed-image hash; unknown images yield nothing", async () => {
    const x = RecordedExtractor.fromFile("mock", path.join(CORPUS, "recorded/mock/index.json"));
    const hit = await x.extract(await processUpload(corpusImage("tsla-5m-bull")));
    assert.deepEqual(hit.raw, recorded);
    const miss = await x.extract(await processUpload(await unknownChart()));
    assert.equal(miss.raw, null);
    assert.equal(miss.failure, "no recording for this image");
  });
  it("defaults to mock; claude requires server-side credentials (API key, token or WIF)", () => {
    assert.equal(selectExtractor({}).provider, "mock");
    assert.throws(() => selectExtractor({ KLYNGE_EXTRACTOR: "claude" }), /requires Anthropic credentials/);
    assert.equal(selectExtractor({ KLYNGE_EXTRACTOR: "claude", ANTHROPIC_API_KEY: "test-key" }).provider, "claude");
    const wif = { ANTHROPIC_FEDERATION_RULE_ID: "fdrl_x", ANTHROPIC_ORGANIZATION_ID: "org", ANTHROPIC_SERVICE_ACCOUNT_ID: "svac_x", ANTHROPIC_IDENTITY_TOKEN_FILE: "/tmp/token" };
    assert.equal(hasAnthropicCredentials(wif), true);
    assert.equal(hasAnthropicCredentials({ ...wif, ANTHROPIC_IDENTITY_TOKEN_FILE: undefined }), false);
    assert.equal(hasAnthropicCredentials({ ANTHROPIC_FEDERATION_RULE_ID: "fdrl_x" }), false);
    assert.equal(hasAnthropicCredentials({ NEXT_PUBLIC_SUPABASE_ANON_KEY: "x" }), false);
  });
});
