/**
 * Local PostgreSQL harness for RLS certification (offline). Boots a throwaway cluster from the system's PostgreSQL
 * binaries, emulates the Supabase pieces the migration depends on (auth schema, auth.uid(), anon / authenticated /
 * service_role, Supabase-style default grants), then applies the real migration file.
 */
import { execFileSync, spawn } from "node:child_process";
import { chownSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";

export const MIGRATION = path.resolve(import.meta.dirname, "../../supabase/migrations/0001_klynge_sessions.sql");
export const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../supabase/migrations");

function pgBin(): string {
  if (process.env.PG_BIN) return process.env.PG_BIN;
  const root = "/usr/lib/postgresql";
  const versions = existsSync(root) ? readdirSync(root).sort((a, b) => Number(b) - Number(a)) : [];
  for (const v of versions) if (existsSync(path.join(root, v, "bin/postgres"))) return path.join(root, v, "bin");
  throw new Error("PostgreSQL binaries not found (set PG_BIN). RLS certification cannot run.");
}

const SUPABASE_BOOTSTRAP = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid
$$;
grant usage on schema auth, public to anon, authenticated, service_role;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.jwt() to anon, authenticated, service_role;
-- Supabase grants table privileges to API roles by default; the migration must revoke what RLS cannot scope.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
`;

export interface Harness {
  pool: pg.Pool;
  stop(): Promise<void>;
}

/** Default: the original 0001 migration only (keeps the 0.5.0 certification unchanged). `all`: every migration in order. */
export async function startPostgres(opts: { migrations?: "0001" | "all" } = {}): Promise<Harness> {
  const bin = pgBin();
  const dir = mkdtempSync(path.join(tmpdir(), "klynge-pg-"));
  const asRoot = process.getuid?.() === 0;
  const run = (cmd: string, args: string[]) => (asRoot ? execFileSync("runuser", ["-u", "postgres", "--", cmd, ...args], { stdio: "pipe" }) : execFileSync(cmd, args, { stdio: "pipe" }));
  if (asRoot) {
    const uid = Number(execFileSync("id", ["-u", "postgres"]).toString().trim());
    const gid = Number(execFileSync("id", ["-g", "postgres"]).toString().trim());
    chownSync(dir, uid, gid);
  }
  const data = path.join(dir, "data");
  run(path.join(bin, "initdb"), ["-D", data, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--no-instructions"]);
  const port = 20000 + Math.floor(Math.random() * 20000);
  const args = ["-D", data, "-k", dir, "-p", String(port), "-c", "listen_addresses=", "-c", "fsync=off"];
  const proc = asRoot ? spawn("runuser", ["-u", "postgres", "--", path.join(bin, "postgres"), ...args], { stdio: "ignore" }) : spawn(path.join(bin, "postgres"), args, { stdio: "ignore" });
  const pool = new pg.Pool({ host: dir, port, user: "postgres", database: "postgres", max: 4 });
  for (let i = 0; ; i++) {
    try {
      await pool.query("select 1");
      break;
    } catch (e) {
      if (i > 100) throw e;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  await pool.query(SUPABASE_BOOTSTRAP);
  if (opts.migrations === "all") {
    // Every migration, in order (0001, 0002, ...), exactly as they would be applied to the hosted project.
    for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith(".sql")).sort()) await pool.query(readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"));
  } else await pool.query(readFileSync(MIGRATION, "utf8"));
  return {
    pool,
    async stop() {
      await pool.end();
      try {
        run(path.join(bin, "pg_ctl"), ["stop", "-D", data, "-m", "fast", "-w", "-t", "20"]);
      } catch {
        proc.kill("SIGKILL");
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Run `sql` as an API role with a JWT subject, inside a rolled-back transaction (like PostgREST). */
export async function as<T = Record<string, unknown>>(pool: pg.Pool, role: "anon" | "authenticated" | "service_role", sub: string | null, sql: string, params: unknown[] = [], claims: Record<string, unknown> = {}): Promise<T[]> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(`set local role ${role}`);
    await c.query("select set_config('request.jwt.claims', $1, true)", [sub ? JSON.stringify({ sub, role, ...claims }) : ""]);
    const r = await c.query(sql, params);
    await c.query("commit");
    return r.rows as T[];
  } catch (e) {
    await c.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}
