import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";
import { scoreCorpus } from "./accuracy.ts";
import { IntakeError } from "./intake.ts";
import { RateLimiter } from "./rate-limit.ts";
import { MemoryTelemetrySink, track } from "./telemetry.ts";
import { APP_ROOT, CORPUS, corpusImage, MIN, T, testDeps } from "./test-support.ts";
import { resetSession, uploadChart, WorkspaceError } from "./workspace.ts";

const upload = (deps: ReturnType<typeof testDeps>, id: string, now: number, tenantId = "tenant-a") =>
  uploadChart(deps, { tenantId, sessionId: "s1", bytes: corpusImage(id), hints: {}, actor: "user", now });

describe("rate limiting", () => {
  it("token bucket refills on the explicit clock", () => {
    const rl = new RateLimiter({ capacity: 2, refillPerMs: 1 / MIN });
    assert.equal(rl.take("t", T).allowed, true);
    assert.equal(rl.take("t", T).allowed, true);
    const denied = rl.take("t", T);
    assert.equal(denied.allowed, false);
    assert.equal(denied.retryAfterMs, MIN);
    assert.equal(rl.take("other", T).allowed, true, "per tenant");
    assert.equal(rl.take("t", T + MIN).allowed, true);
  });
  it("uploads beyond the limit => RATE_LIMITED before any extraction", async () => {
    const deps = testDeps({ limit: { capacity: 1, refillPerMs: 1 / MIN } });
    await upload(deps, "tsla-5m-bull", T);
    await assert.rejects(upload(deps, "spx-5m-bull", T), (e: unknown) => e instanceof WorkspaceError && e.code === "RATE_LIMITED" && e.retryAfterMs > 0);
    assert.equal(deps.telemetry.events.filter((e) => e.name === "chart.extraction").length, 1);
    assert.equal(deps.telemetry.events.at(-1)?.name, "rate.limited");
  });
});

describe("intake errors reach the HTTP edge typed (413/415, not 400)", () => {
  it("spoofed or empty uploads reject with IntakeError and are tracked as rejected", async () => {
    const deps = testDeps();
    await assert.rejects(
      uploadChart(deps, { tenantId: "tenant-a", sessionId: "s1", bytes: Buffer.from("<svg/>"), hints: {}, actor: "user", now: T }),
      (e: unknown) => e instanceof IntakeError && e.code === "UNSUPPORTED_TYPE",
    );
    assert.equal(deps.telemetry.events.at(-1)?.attrs.outcome, "rejected");
    assert.equal(await deps.store.getSession("tenant-a", "s1"), undefined);
  });
});

describe("telemetry (no image bytes, no PII)", () => {
  it("allow-lists attributes and hashes the tenant", () => {
    const sink = new MemoryTelemetrySink();
    const e = track(sink, "chart.intake", "tenant-a", T, { bytes: 10, mime: "image/png", image: "iVBORw0KGgo", note: "my balance", tenantId: "tenant-a" });
    assert.deepEqual(Object.keys(e.attrs).sort(), ["bytes", "mime"]);
    assert.notEqual(e.tenant, "tenant-a");
    assert.match(e.tenant, /^[0-9a-f]{16}$/);
  });
  it("a full upload flow (including a broker screenshot) emits nothing sensitive", async () => {
    const deps = testDeps();
    await upload(deps, "broker-balance-tsla", T);
    await upload(deps, "spx-5m-bull", T + MIN);
    const dump = JSON.stringify(deps.telemetry.events);
    assert.ok(deps.telemetry.events.length >= 6);
    for (const forbidden of ["iVBORw0KGgo", corpusImage("broker-balance-tsla").toString("base64").slice(100, 140), "tenant-a", "4471", "12,345", "Balance"]) {
      assert.ok(!dump.includes(forbidden), forbidden);
    }
  });
});

describe("image retention", () => {
  it("SESSION keeps processed images until reset; NONE never keeps them", async () => {
    const keep = testDeps({ retention: "SESSION" });
    const v = await upload(keep, "tsla-5m-bull", T);
    const chartId = v.charts[0]!.chartId;
    const sha = [...(keep.images as unknown as { images: Map<string, Buffer> }).images.keys()][0]!.split("\u0000")[2]!;
    assert.ok(sha.startsWith(chartId));
    assert.equal(keep.images.has("tenant-a", "s1", sha), true);
    await resetSession(keep, "tenant-a", "s1");
    assert.equal(keep.images.has("tenant-a", "s1", sha), false);
    assert.equal(await keep.store.getSession("tenant-a", "s1"), undefined);

    const none = testDeps({ retention: "NONE" });
    await upload(none, "tsla-5m-bull", T);
    assert.equal((none.images as unknown as { images: Map<string, Buffer> }).images.size, 0);
  });
});

describe("accuracy harness (recorded corpus — no network)", () => {
  it("scores the mock recordings against golden labels and surfaces confident errors", () => {
    const r = scoreCorpus(CORPUS, "mock");
    assert.equal(r.images, 7);
    assert.equal(r.overall.wrong, 1);
    assert.ok((r.overall.precision ?? 0) > 0.95);
    assert.deepEqual(r.confidentErrors.map((e) => `${e.image}:${e.field}`), ["tsla-5m-bear:structure"]);
    const lastPrice = r.fields.find((f) => f.field === "lastPrice")!;
    assert.ok(lastPrice.abstained >= 1, "MNQ misread is caught by the axis cross-check, not counted as correct");
    assert.ok(r.calibration.every((b) => b.accuracy === null || (b.accuracy >= 0 && b.accuracy <= 1)));
  });
  it("missing provider recordings score zero images (live corpus is recorded manually)", () => {
    assert.equal(scoreCorpus(CORPUS, "claude").images, 0);
  });
});

describe("client-bundle guard", () => {
  it("flags engine code, rule versions, prompts and secrets; passes clean chunks", async () => {
    const mod = (await import(pathToFileURL(path.join(APP_ROOT, "scripts/check-client-bundle.mjs")).href)) as { scan: (dir: string) => string[] };
    const dir = mkdtempSync(path.join(tmpdir(), "klynge-bundle-"));
    mkdirSync(path.join(dir, "chunks"));
    writeFileSync(path.join(dir, "chunks/ok.js"), "export const label='BULLISH CONTEXT';");
    assert.deepEqual(mod.scan(dir), []);
    for (const leak of ["visual-intake-v1", "maxChartSetSkewMs", "evaluateVisualContext", "You read trading chart screenshots", "SUPABASE_SERVICE_ROLE_KEY", "sk-ant-abc"]) {
      writeFileSync(path.join(dir, "chunks/leak.js"), `var x=${JSON.stringify(leak)};`);
      assert.equal(mod.scan(dir).length, 1, leak);
    }
  });
});
