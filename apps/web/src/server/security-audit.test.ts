import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { APP_ROOT } from "./test-support.ts";

/** Batch 77 — security & privacy regression register (source-level invariants; behaviour is covered elsewhere). */
const walk = (d: string, out: string[] = []): string[] => {
  for (const f of readdirSync(d)) {
    const p = path.join(d, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};
const routes = walk(path.join(APP_ROOT, "src/app")).filter((f) => f.endsWith("route.ts"));
const rel = (f: string) => path.relative(APP_ROOT, f).replaceAll(path.sep, "/");
const src = (f: string) => readFileSync(f, "utf8");

describe("security & privacy audit (Batch 77)", () => {
  it("every state-changing API route derives identity server-side or checks a server-only secret / test mode", () => {
    for (const f of routes.filter((r) => /export async function (POST|PUT|PATCH|DELETE)/.test(src(r)))) {
      const s = src(f);
      const guarded = /requestContext\(|KLYNGE_CRON_SECRET|isTestMode\(|gatewayFor\(|serviceRole/.test(s) || rel(f).startsWith("src/app/auth/");
      assert.ok(guarded, `${rel(f)} has no server-side identity or secret check`);
      assert.doesNotMatch(s, /body\.(tenantId|userId|operator|role)\b/, `${rel(f)} must never take ownership or roles from the body`);
    }
  });
  it("the pilot gate is bypassed only by the enrollment flow, privacy rights and operator routes", () => {
    const allowed = ["src/app/api/pilot/activate/route.ts", "src/app/api/account/export/route.ts", "src/app/api/account/delete/route.ts", "src/app/api/admin/ops/route.ts", "src/app/api/admin/ops/recover/route.ts", "src/app/api/admin/pilot/route.ts", "src/app/pilot/page.tsx", "src/app/app/ops/pilot/page.tsx"];
    const bypass = walk(path.join(APP_ROOT, "src/app")).filter((f) => /pilotGate:\s*false/.test(src(f))).map(rel).sort();
    assert.deepEqual(bypass, [...allowed].sort());
  });
  it("operator routes answer 404 to non-operators (existence not disclosed)", () => {
    for (const f of [...routes.filter((r) => rel(r).startsWith("src/app/api/admin/")), path.join(APP_ROOT, "src/app/app/ops/page.tsx"), path.join(APP_ROOT, "src/app/app/ops/pilot/page.tsx")]) {
      const s = src(f);
      assert.match(s, /isOperator\(/, rel(f));
      assert.match(s, /status: 404|notFound\(\)/, rel(f));
    }
  });
  it("workspace cookies are httpOnly, SameSite=Lax and Secure on https; middleware covers every app, API, auth and pilot path", () => {
    const m = src(path.join(APP_ROOT, "src/middleware.ts"));
    assert.match(m, /httpOnly: true, sameSite: "lax" as const, secure: req\.nextUrl\.protocol === "https:"/);
    for (const p of ['"/app/:path*"', '"/api/:path*"', '"/auth/:path*"', '"/sign-in"', '"/pilot"']) assert.ok(m.includes(p), p);
    assert.match(m, /csrfVerdict\(/);
  });
  it("account deletion requires a typed confirmation; export never includes message bodies or image data", () => {
    const p = src(path.join(APP_ROOT, "src/server/account/privacy.ts"));
    assert.match(p, /DELETE_CONFIRMATION = "DELETE MY DATA"/);
    assert.match(p, /\(\{ text: _t, \.\.\.o \}\) => o/, "notification bodies are stripped from exports");
    assert.doesNotMatch(p, /images\.(get|read)/);
  });
  it("the findings register exists, every finding has severity + status, and no OPEN finding is critical", () => {
    const reg = readFileSync(path.join(APP_ROOT, "../../docs/security/findings-register.md"), "utf8");
    const rows = [...reg.matchAll(/^\| (KLY-SEC-\d{3}) \| ([A-Z]+) \| ([A-Z_]+) \|/gm)];
    assert.ok(rows.length >= 8);
    for (const [, id, sev, status] of rows) {
      assert.ok(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"].includes(sev!), id);
      assert.ok(["OPEN", "FIXED", "MITIGATED", "ACCEPTED", "VERIFIED"].includes(status!), id);
      assert.ok(!(sev === "CRITICAL" && status === "OPEN"), `${id}: critical findings cannot stay open`);
    }
  });
  it("bundle guard covers 0.8.0 internals", async () => {
    const { mkdirSync, mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { pathToFileURL } = await import("node:url");
    const mod = (await import(pathToFileURL(path.join(APP_ROOT, "scripts/check-client-bundle.mjs")).href)) as { scan: (dir: string) => string[] };
    const dir = mkdtempSync(path.join(tmpdir(), "klynge-bundle5-"));
    mkdirSync(path.join(dir, "chunks"));
    for (const leak of ["pilot-operations-v1", "pilotGateVerdict", "evidenceLedger", "pilotAnalytics", "adminAction", "policyFingerprint", "releaseReadiness", "KLYNGE_RELEASE_AUTHORIZED", "klynge_ops_audit"]) {
      writeFileSync(path.join(dir, "chunks/leak.js"), `var x=${JSON.stringify(leak)};`);
      assert.ok(mod.scan(dir).length >= 1, leak);
    }
  });
});
