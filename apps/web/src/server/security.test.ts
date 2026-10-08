import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";
import { MemoryTelemetrySink, track } from "./telemetry.ts";
import { APP_ROOT } from "./test-support.ts";

describe("client secret + IP scan (bundle guard, auth-live-data-v1)", () => {
  it("flags service-role, JWTs, test machinery, provider + runtime internals", async () => {
    const mod = (await import(pathToFileURL(path.join(APP_ROOT, "scripts/check-client-bundle.mjs")).href)) as { scan: (dir: string) => string[] };
    const dir = mkdtempSync(path.join(tmpdir(), "klynge-bundle2-"));
    mkdirSync(path.join(dir, "chunks"));
    writeFileSync(path.join(dir, "chunks/ok.js"), "export const t='DATA VERIFIED';export const v='VISUAL ANALYSIS';");
    assert.deepEqual(mod.scan(dir), []);
    const jwt = ["eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", "eyJyb2xlIjoic2VydmljZV9yb2xlIn0", "sig"].join(".");
    for (const leak of ["auth-live-data-v1", "service_role", jwt, "KLYNGE_TEST_AUTH_SECRET", "klynge_mock_session", "normalizeFeed", "maxFeedSkewMs", "runDataCycle", "RUNTIME_STATE_UNAVAILABLE", "x-klynge-provider-scenario"]) {
      writeFileSync(path.join(dir, "chunks/leak.js"), `var x=${JSON.stringify(leak)};`);
      assert.ok(mod.scan(dir).length >= 1, leak);
    }
  });
});

describe("auth/provider telemetry carries no tokens or PII", () => {
  it("drops emails, tokens and user ids; keeps only allow-listed attributes", () => {
    const sink = new MemoryTelemetrySink();
    const e = track(sink, "auth.sign_in", "11111111-1111-4111-a111-111111111111", 1, { method: "google", outcome: "ok", email: "a@b.c", access_token: "eyJ.x.y", code: "secret" });
    assert.deepEqual(e.attrs, { method: "google", outcome: "ok" });
    assert.doesNotMatch(JSON.stringify(sink.events), /a@b\.c|eyJ|secret|11111111-1111/);
    const d = track(sink, "data.cycle", "u", 1, { kind: "PROVIDER_FAILURE", provider: "mock", permission: "BLOCKED", decision: "", apiKey: "k" });
    assert.deepEqual(Object.keys(d.attrs).sort(), ["decision", "kind", "permission", "provider"]);
  });
});
