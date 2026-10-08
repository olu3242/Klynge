import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { isAllowedServiceRoleOperation, SERVICE_ROLE_OPERATIONS, serviceRoleClient } from "./admin/service-role.ts";
import { APP_ROOT } from "./test-support.ts";

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(f) && !/\.test\.ts$/.test(f)) out.push(p);
  }
  return out;
}

describe("SERVICE ROLE ≠ USER AUTHORIZATION", () => {
  it("is a short explicit allowlist of non-user operations", () => {
    assert.deepEqual(Object.keys(SERVICE_ROLE_OPERATIONS), ["schema.verify", "certification.test-users", "maintenance.cleanup"]);
    for (const op of ["session.read", "decision.write", "journal.insert", "user.crud"]) assert.equal(isAllowedServiceRoleOperation(op), false, op);
    assert.throws(() => serviceRoleClient("session.read", { SUPABASE_URL: "https://x", SUPABASE_SERVICE_ROLE_KEY: "k" }), /not allow-listed/);
    assert.throws(() => serviceRoleClient("schema.verify", {}), /are required/);
  });
  it("no user request path references the service role (source scan)", () => {
    const src = walk(path.join(APP_ROOT, "src"));
    const offenders = src.filter((f) => !f.includes(`${path.sep}server${path.sep}admin${path.sep}`)).filter((f) => {
      const t = readFileSync(f, "utf8");
      return /SUPABASE_SERVICE_ROLE_KEY|service[-_]role|serviceRoleClient|server\/admin\//i.test(t.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""));
    });
    assert.deepEqual(offenders.map((f) => path.relative(APP_ROOT, f)), []);
  });
  it("user CRUD is user-bound: the Supabase store takes a client + verified user id, never env secrets", () => {
    const store = readFileSync(path.join(APP_ROOT, "src/server/store/supabase-store.ts"), "utf8");
    assert.match(store, /constructor\(userBoundClient: SupabaseClient, verifiedUserId: string\)/);
    assert.doesNotMatch(store, /process\.env|createClient\(/);
    const runtime = readFileSync(path.join(APP_ROOT, "src/server/runtime.ts"), "utf8");
    assert.match(runtime, /new SupabaseSessionStore\(gateway\.client, identity\.user\.id\)/);
  });
  it("only public Supabase values are NEXT_PUBLIC_*", () => {
    const env = readFileSync(path.join(APP_ROOT, ".env.example"), "utf8");
    const pub = [...env.matchAll(/^(NEXT_PUBLIC_[A-Z_]+)=/gm)].map((m) => m[1]);
    assert.deepEqual(pub.sort(), ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_URL"]);
    for (const s of src()) assert.doesNotMatch(readFileSync(s, "utf8"), /NEXT_PUBLIC_(?!SUPABASE_URL|SUPABASE_ANON_KEY)[A-Z_]*(KEY|SECRET|TOKEN)/, s);
  });
});

const src = () => walk(path.join(APP_ROOT, "src"));
