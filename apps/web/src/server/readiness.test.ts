import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readinessSummary, validateHostedEnv } from "./admin/readiness.ts";

const jwtish = (s: string) => `eyJ${s}.eyJ${s}.${s}`;
const GOOD = {
  NEXT_PUBLIC_SUPABASE_URL: "https://mdshgiqynukrbkyxgmur.supabase.co",
  SUPABASE_URL: "https://mdshgiqynukrbkyxgmur.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: jwtish("publicpart"),
  SUPABASE_SERVICE_ROLE_KEY: jwtish("secretpart"),
  KLYNGE_SITE_URL: "https://klynge.example",
  KLYNGE_STORE: "supabase",
  KLYNGE_DEPLOYMENT: "production",
};

describe("hosted environment validation (shape only, never values)", () => {
  it("a complete production env is READY for the expected project", () => {
    const s = readinessSummary(validateHostedEnv(GOOD, "mdshgiqynukrbkyxgmur"));
    assert.deepEqual(s, { ready: true, failed: [], warnings: [] });
  });
  it("flags wrong project, missing keys, reused keys, test mode, mock auth and browser-exposed secrets", () => {
    const bad = { ...GOOD, NEXT_PUBLIC_SUPABASE_URL: "https://otherprojectrefxxxxx1.supabase.co", SUPABASE_SERVICE_ROLE_KEY: GOOD.NEXT_PUBLIC_SUPABASE_ANON_KEY, KLYNGE_TEST_MODE: "1", KLYNGE_AUTH: "mock", NEXT_PUBLIC_STRIPE_SECRET: "x", KLYNGE_SITE_URL: "http://insecure" };
    const s = readinessSummary(validateHostedEnv(bad, "mdshgiqynukrbkyxgmur"));
    for (const id of ["supabase.project", "supabase.server-url", "supabase.keys-distinct", "test-mode.off", "auth.mode", "public-secret:NEXT_PUBLIC_STRIPE_SECRET", "site.url"]) assert.ok(s.failed.includes(id), id);
    assert.equal(s.ready, false);
  });
  it("never echoes a secret value in any detail", () => {
    const checks = validateHostedEnv({ ...GOOD, SUPABASE_SERVICE_ROLE_KEY: jwtish("TOPSECRETVALUE") });
    assert.ok(!JSON.stringify(checks).includes("TOPSECRETVALUE"));
    assert.ok(!JSON.stringify(validateHostedEnv({})).includes("eyJ"));
  });
});
