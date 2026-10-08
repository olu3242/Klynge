import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { as, startPostgres } from "./pg-harness.ts";
import type { Harness } from "./pg-harness.ts";

const A = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb";
let h: Harness;
const denied = (re = /row-level security|permission denied|append-only|violates/) => (e: unknown) => re.test((e as Error).message);

const session = (t: string, id: string) => JSON.stringify({ tenantId: t, sessionId: id, createdAt: 1, charts: [] });
const visual = (t: string, id: string, permission = "WAIT") => JSON.stringify({ recordId: id, tenantId: t, evidenceMode: "VISUAL", visual: { permission, label: "BULLISH CONTEXT" } });
const data = (t: string, id: string) => JSON.stringify({ recordId: id, tenantId: t, evidenceMode: "DATA", data: { evidenceMode: "DATA", decision: "CALL_SETUP" } });
const insSession = "insert into public.klynge_sessions (tenant_id, session_id, payload) values ($1, $2, $3)";
const insDecision = "insert into public.klynge_decisions (tenant_id, record_id, session_id, symbol, evidence_mode, at, payload) values ($1, $2, 's', 'TSLA', $3, 1, $4)";

before(async () => {
  h = await startPostgres();
  await h.pool.query("insert into auth.users (id, email) values ($1, 'a@example.com'), ($2, 'b@example.com')", [A, B]);
  // B's data, written as B (through RLS).
  await as(h.pool, "authenticated", B, insSession, [B, "sb", session(B, "sb")]);
  await as(h.pool, "authenticated", B, insDecision, [B, "rb", "DATA", data(B, "rb")]);
  await as(h.pool, "authenticated", B, "insert into public.klynge_alerts (tenant_id, alert_id, at, payload) values ($1, 'ab', 1, $2)", [B, JSON.stringify({ alertId: "ab" })]);
  await as(h.pool, "authenticated", B, "insert into public.klynge_journal (tenant_id, entry_id, record_id, symbol, note, author, created_at) values ($1, 'jb', 'rb', 'TSLA', 'b note', 'b', 1)", [B]);
  await as(h.pool, "authenticated", B, "insert into public.klynge_runtime_state (tenant_id, runtime_id, last_market_timestamp, payload) values ($1, 'rt', 5, $2)", [B, JSON.stringify({ runtimeId: "rt", lastMarketTimestamp: 5 })]);
});
after(async () => h?.stop());

describe("RLS certification (local PostgreSQL + Supabase auth emulation)", () => {
  it("RLS is enabled on every durable table", async () => {
    const rows = await h.pool.query("select relname, relrowsecurity from pg_class where relname like 'klynge_%' and relkind = 'r' order by relname");
    assert.deepEqual(rows.rows.map((r) => [r.relname, r.relrowsecurity]), [["klynge_alerts", true], ["klynge_decisions", true], ["klynge_journal", true], ["klynge_runtime_state", true], ["klynge_sessions", true]]);
  });
  it("own-user CRUD on sessions; tenant defaults to auth.uid()", async () => {
    await as(h.pool, "authenticated", A, "insert into public.klynge_sessions (session_id, payload) values ('sa', $1)", [session(A, "sa")]);
    assert.equal((await as(h.pool, "authenticated", A, "select * from public.klynge_sessions")).length, 1);
    await as(h.pool, "authenticated", A, "update public.klynge_sessions set payload = $1 where session_id = 'sa'", [session(A, "sa")]);
    await as(h.pool, "authenticated", A, "delete from public.klynge_sessions where session_id = 'sa'");
    assert.equal((await as(h.pool, "authenticated", A, "select * from public.klynge_sessions")).length, 0);
  });
  it("user A cannot read user B (any table)", async () => {
    for (const t of ["klynge_sessions", "klynge_decisions", "klynge_alerts", "klynge_journal", "klynge_runtime_state"]) {
      assert.equal((await as(h.pool, "authenticated", A, `select * from public.${t}`)).length, 0, t);
      assert.equal((await as(h.pool, "authenticated", B, `select * from public.${t}`)).length, 1, `${t} (owner sees own)`);
    }
  });
  it("user A cannot update or delete user B", async () => {
    assert.equal((await as(h.pool, "authenticated", A, "update public.klynge_sessions set origin = 'DIRECT' where tenant_id = $1 returning 1", [B])).length, 0);
    assert.equal((await as(h.pool, "authenticated", A, "delete from public.klynge_sessions where tenant_id = $1 returning 1", [B])).length, 0);
    assert.equal((await as(h.pool, "authenticated", A, "update public.klynge_runtime_state set last_market_timestamp = 5 where tenant_id = $1 returning 1", [B])).length, 0);
    assert.equal((await h.pool.query("select count(*)::int as n from public.klynge_sessions where tenant_id = $1", [B])).rows[0].n, 1);
  });
  it("user A cannot insert rows for user B, nor re-own a row to B", async () => {
    await assert.rejects(as(h.pool, "authenticated", A, insSession, [B, "x", session(B, "x")]), denied(/row-level security/));
    await assert.rejects(as(h.pool, "authenticated", A, insDecision, [B, "x", "DATA", data(B, "x")]), denied(/row-level security/));
    await assert.rejects(as(h.pool, "authenticated", A, "insert into public.klynge_alerts (tenant_id, alert_id, at, payload) values ($1, 'x', 1, $2)", [B, JSON.stringify({ alertId: "x" })]), denied(/row-level security/));
    await as(h.pool, "authenticated", A, insSession, [A, "mine", session(A, "mine")]);
    await assert.rejects(as(h.pool, "authenticated", A, "update public.klynge_sessions set tenant_id = $1 where session_id = 'mine'", [B]), denied());
  });
  it("anonymous cannot read or write durable user data", async () => {
    for (const t of ["klynge_sessions", "klynge_decisions", "klynge_alerts", "klynge_journal", "klynge_runtime_state"]) {
      await assert.rejects(as(h.pool, "anon", null, `select * from public.${t}`), denied(/permission denied/), t);
    }
    await assert.rejects(as(h.pool, "anon", null, insSession, [B, "anon", session(B, "anon")]), denied(/permission denied/));
    assert.equal((await as(h.pool, "authenticated", null, "select * from public.klynge_sessions")).length, 0, "a token without a subject sees nothing");
    await assert.rejects(as(h.pool, "authenticated", null, insSession, [B, "nosub", session(B, "nosub")]), denied(/row-level security/));
  });
  it("decisions and alerts are append-only (no update, no user delete)", async () => {
    await assert.rejects(as(h.pool, "authenticated", B, "update public.klynge_decisions set at = 2 where record_id = 'rb'"), denied(/permission denied|append-only/));
    await assert.rejects(as(h.pool, "authenticated", B, "delete from public.klynge_decisions where record_id = 'rb'"), denied(/permission denied/));
    await assert.rejects(as(h.pool, "authenticated", B, "update public.klynge_alerts set at = 2"), denied(/permission denied|append-only/));
    await assert.rejects(h.pool.query("update public.klynge_decisions set at = 2 where record_id = 'rb'"), denied(/append-only/), "even the owner role cannot rewrite history");
    await assert.rejects(as(h.pool, "service_role", null, "update public.klynge_alerts set at = 2"), denied(/append-only/), "service role cannot rewrite history either");
    await assert.rejects(as(h.pool, "authenticated", B, "update public.klynge_journal set note = 'edited'"), denied(/permission denied|append-only/));
    await assert.rejects(as(h.pool, "authenticated", B, "delete from public.klynge_journal"), denied(/permission denied/));
  });
  it("VISUAL rows can never hold a directional decision; payload ownership must match", async () => {
    await as(h.pool, "authenticated", A, insDecision, [A, "va", "VISUAL", visual(A, "va")]);
    await assert.rejects(as(h.pool, "authenticated", A, insDecision, [A, "vb", "VISUAL", data(A, "vb").replace('"evidenceMode":"DATA","data"', '"evidenceMode":"VISUAL","data"')]), denied(/klynge_visual_not_directional/));
    await assert.rejects(as(h.pool, "authenticated", A, insDecision, [A, "vc", "VISUAL", visual(A, "vc", "ELIGIBLE")]), denied(/klynge_visual_not_directional/));
    await assert.rejects(as(h.pool, "authenticated", A, insDecision, [A, "vd", "DATA", visual(A, "vd")]), denied(/payload_owner|klynge_data_is_data/));
    await assert.rejects(as(h.pool, "authenticated", A, insDecision, [A, "ve", "VISUAL", visual(B, "ve")]), denied(/payload_owner/));
  });
  it("journal: read own, insert own, only against own decisions", async () => {
    await as(h.pool, "authenticated", A, insDecision, [A, "ra", "DATA", data(A, "ra")]);
    await as(h.pool, "authenticated", A, "insert into public.klynge_journal (tenant_id, entry_id, record_id, symbol, note, author, created_at) values ($1, 'ja', 'ra', 'TSLA', 'a note', 'a', 1)", [A]);
    assert.deepEqual((await as<{ note: string }>(h.pool, "authenticated", A, "select note from public.klynge_journal")).map((r) => r.note), ["a note"]);
    await assert.rejects(as(h.pool, "authenticated", A, "insert into public.klynge_journal (tenant_id, entry_id, record_id, symbol, note, author, created_at) values ($1, 'jx', 'rb', 'TSLA', 'note on B', 'a', 1)", [A]), denied(/foreign key/));
  });
  it("alerts + runtime cursors: own only", async () => {
    await as(h.pool, "authenticated", A, "insert into public.klynge_alerts (alert_id, at, payload) values ('aa', 1, $1)", [JSON.stringify({ alertId: "aa" })]);
    await as(h.pool, "authenticated", A, "insert into public.klynge_runtime_state (runtime_id, last_market_timestamp, payload) values ('rt', 7, $1)", [JSON.stringify({ runtimeId: "rt", lastMarketTimestamp: 7 })]);
    await as(h.pool, "authenticated", A, "update public.klynge_runtime_state set last_market_timestamp = 8, payload = $1 where runtime_id = 'rt'", [JSON.stringify({ runtimeId: "rt", lastMarketTimestamp: 8 })]);
    assert.deepEqual((await as<{ t: string }>(h.pool, "authenticated", A, "select last_market_timestamp::text as t from public.klynge_runtime_state")).map((r) => r.t), ["8"]);
    assert.deepEqual((await as<{ t: string }>(h.pool, "authenticated", B, "select last_market_timestamp::text as t from public.klynge_runtime_state")).map((r) => r.t), ["5"]);
    await assert.rejects(as(h.pool, "authenticated", A, "delete from public.klynge_runtime_state"), denied(/permission denied/));
  });
  it("service role bypasses RLS — which is why it is allow-listed and never used for user CRUD", async () => {
    assert.ok((await as(h.pool, "service_role", null, "select * from public.klynge_sessions")).length >= 2);
  });
});
