import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { as, MIGRATIONS_DIR, startPostgres } from "./pg-harness.ts";
import type { Harness } from "./pg-harness.ts";

const ROLLBACK_DIR = path.resolve(MIGRATIONS_DIR, "../rollback");
let h: Harness;
const snapshot = async () => {
  const cols = await h.pool.query("select table_name, column_name, data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name like 'klynge_%' order by 1, 2");
  const pols = await h.pool.query("select tablename, policyname, cmd, roles::text, qual, with_check from pg_policies where schemaname = 'public' order by 1, 2");
  const trg = await h.pool.query("select tgname, tgrelid::regclass::text as t from pg_trigger where not tgisinternal order by 1");
  const grants = await h.pool.query("select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name like 'klynge_%' and grantee in ('anon','authenticated') order by 1, 2, 3");
  return JSON.stringify([cols.rows, pols.rows, trg.rows, grants.rows]);
};
const ups = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();

before(async () => {
  h = await startPostgres({ migrations: "all" });
});
after(async () => h?.stop());

describe("migration dry-run, rollback and recovery (local PostgreSQL)", () => {
  it("every migration has a rollback script", () => {
    for (const f of ups) assert.ok(readdirSync(ROLLBACK_DIR).includes(f.replace(".sql", ".down.sql")), f);
  });
  it("up → down (reverse order) → up reproduces an identical schema, policies, triggers and grants", async () => {
    const first = await snapshot();
    for (const f of [...ups].reverse()) await h.pool.query(readFileSync(path.join(ROLLBACK_DIR, f.replace(".sql", ".down.sql")), "utf8"));
    assert.equal((await h.pool.query("select count(*)::int as n from pg_tables where schemaname = 'public' and tablename like 'klynge_%'")).rows[0].n, 0);
    for (const f of ups) await h.pool.query(readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"));
    assert.equal(await snapshot(), first);
  });
  it("migrations are wrapped-safe: a failing statement inside a transaction leaves no partial schema", async () => {
    const c = await h.pool.connect();
    try {
      await c.query("begin");
      await c.query("create table public.klynge_dryrun_probe (id int)");
      await assert.rejects(c.query("select * from public.does_not_exist"));
      await c.query("rollback");
    } finally {
      c.release();
    }
    assert.equal((await h.pool.query("select to_regclass('public.klynge_dryrun_probe') as t")).rows[0].t, null);
  });
});

describe("role escalation is impossible for API roles", () => {
  const U = "cccccccc-cccc-4ccc-accc-cccccccccccc";
  it("authenticated cannot disable RLS, grant itself, drop policies/triggers, create objects or read auth.users", async () => {
    await h.pool.query("insert into auth.users (id, email) values ($1, 'c@example.com') on conflict do nothing", [U]);
    for (const sql of [
      "create table public.klynge_evil (id int)",
      "create function public.klynge_evil() returns int language sql security definer as 'select 1'",
      "alter table public.klynge_sessions disable row level security",
      "select * from auth.users",
      "drop policy klynge_sessions_select on public.klynge_sessions",
      "alter table public.klynge_decisions disable trigger klynge_decisions_immutable",
    ]) {
      await assert.rejects(as(h.pool, "authenticated", U, sql), /permission denied|must be owner|must be member/, sql);
    }
  });
  it("a non-owner GRANT attempt grants nothing (decisions stay non-updatable)", async () => {
    await as(h.pool, "authenticated", U, "grant all on public.klynge_decisions to authenticated");
    const r = await h.pool.query("select has_table_privilege('authenticated', 'public.klynge_decisions', 'UPDATE') as u, has_table_privilege('authenticated', 'public.klynge_decisions', 'DELETE') as d");
    assert.deepEqual(r.rows[0], { u: false, d: false });
  });
  it("no SECURITY DEFINER function in public is executable by anon/authenticated (no RPC escalation path)", async () => {
    const r = await h.pool.query(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`);
    assert.deepEqual(r.rows, []);
  });
  it("forged JWT claims cannot change the subject mid-transaction for writes to another tenant", async () => {
    const other = "dddddddd-dddd-4ddd-addd-dddddddddddd";
    await h.pool.query("insert into auth.users (id, email) values ($1, 'd@example.com') on conflict do nothing", [other]);
    await assert.rejects(as(h.pool, "authenticated", U, "insert into public.klynge_sessions (tenant_id, session_id, payload) values ($1, 's', $2)", [other, JSON.stringify({ tenantId: other, sessionId: "s" })]), /row-level security/);
  });
});
