import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { as, startPostgres } from "./pg-harness.ts";
import type { Harness } from "./pg-harness.ts";

const A = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb";
const EA = { email: "a@example.com" };
const EB = { email: "b@example.com" };
let h: Harness;
const denied = (re = /row-level security|permission denied|append-only|violates/) => (e: unknown) => re.test((e as Error).message);
const prefs = (address: string | null) => JSON.stringify({ version: 1, email: { enabled: Boolean(address), address, events: "ALL", minSeverity: "ATTENTION" }, maxPerHour: 6 });
const outbox = (id: string, to: string, status = "PENDING") => JSON.stringify({ notificationId: id, to, status });
const decision = (t: string, id: string) => JSON.stringify({ recordId: id, tenantId: t, evidenceMode: "DATA", data: { evidenceMode: "DATA", decision: "CALL_SETUP" } });

before(async () => {
  h = await startPostgres({ migrations: "all" });
  await h.pool.query("insert into auth.users (id, email) values ($1, 'a@example.com'), ($2, 'b@example.com')", [A, B]);
  for (const [u, claims] of [[A, EA], [B, EB]] as const) {
    await as(h.pool, "authenticated", u, "insert into public.klynge_decisions (tenant_id, record_id, session_id, symbol, evidence_mode, at, payload) values ($1, 'r1', 's', 'TSLA', 'DATA', 1, $2)", [u, decision(u, "r1")], claims);
  }
});
after(async () => h?.stop());

describe("RLS certification — account tables (migration 0002)", () => {
  it("RLS enabled on every account table", async () => {
    const r = await h.pool.query("select relname, relrowsecurity from pg_class where relname in ('klynge_user_policies','klynge_policy_verdicts','klynge_notification_prefs','klynge_notification_outbox','klynge_audit_log') order by relname");
    assert.equal(r.rows.length, 5);
    assert.ok(r.rows.every((x) => x.relrowsecurity === true));
  });
  it("preferences: own read/write; cross-user invisible; anonymous denied", async () => {
    await as(h.pool, "authenticated", A, "insert into public.klynge_user_policies (payload) values ($1)", [JSON.stringify({ version: 1, maxLossPerTrade: 100 })], EA);
    await as(h.pool, "authenticated", A, "update public.klynge_user_policies set payload = $1", [JSON.stringify({ version: 1, maxLossPerTrade: 50 })], EA);
    assert.equal((await as(h.pool, "authenticated", A, "select * from public.klynge_user_policies", [], EA)).length, 1);
    assert.equal((await as(h.pool, "authenticated", B, "select * from public.klynge_user_policies", [], EB)).length, 0);
    await assert.rejects(as(h.pool, "authenticated", B, "insert into public.klynge_user_policies (tenant_id, payload) values ($1, $2)", [A, JSON.stringify({ version: 1 })], EB), denied(/row-level security/));
    await assert.rejects(as(h.pool, "anon", null, "select * from public.klynge_user_policies"), denied(/permission denied/));
  });
  it("policy verdicts: append-only, own decisions only, separate from the decision row", async () => {
    await as(h.pool, "authenticated", A, "insert into public.klynge_policy_verdicts (record_id, at, payload) values ('r1', 1, $1)", [JSON.stringify({ recordId: "r1", tenantId: A, vetoes: [] })], EA);
    await assert.rejects(as(h.pool, "authenticated", A, "update public.klynge_policy_verdicts set at = 2", [], EA), denied(/permission denied|append-only/));
    await assert.rejects(as(h.pool, "authenticated", A, "insert into public.klynge_policy_verdicts (record_id, at, payload) values ('missing', 1, $1)", [JSON.stringify({ recordId: "missing", tenantId: A })], EA), denied(/foreign key/));
    const decisionRow = await h.pool.query("select payload from public.klynge_decisions where tenant_id = $1 and record_id = 'r1'", [A]);
    assert.equal(decisionRow.rows[0].payload.data.decision, "CALL_SETUP", "engine decision untouched by a veto");
  });
  it("notifications can only target the caller's own verified email", async () => {
    await as(h.pool, "authenticated", A, "insert into public.klynge_notification_prefs (payload) values ($1)", [prefs("a@example.com")], EA);
    await assert.rejects(as(h.pool, "authenticated", B, "insert into public.klynge_notification_prefs (payload) values ($1)", [prefs("victim@example.com")], EB), denied(/row-level security/));
    await as(h.pool, "authenticated", A, "insert into public.klynge_notification_outbox (notification_id, status, next_attempt_at, payload) values ('n-0000001', 'PENDING', 1, $1)", [outbox("n-0000001", "a@example.com")], EA);
    await assert.rejects(as(h.pool, "authenticated", A, "insert into public.klynge_notification_outbox (notification_id, status, next_attempt_at, payload) values ('n-0000002', 'PENDING', 1, $1)", [outbox("n-0000002", "victim@example.com")], EA), denied(/row-level security/));
    await as(h.pool, "authenticated", A, "update public.klynge_notification_outbox set status = 'DELIVERED', payload = $1 where notification_id = 'n-0000001'", [outbox("n-0000001", "a@example.com", "DELIVERED")], EA);
    assert.equal((await as(h.pool, "authenticated", B, "select * from public.klynge_notification_outbox", [], EB)).length, 0);
    await assert.rejects(as(h.pool, "authenticated", A, "delete from public.klynge_notification_outbox", [], EA), denied(/permission denied/));
  });
  it("audit log: append-only, own only, allow-listed actions", async () => {
    await as(h.pool, "authenticated", A, "insert into public.klynge_audit_log (audit_id, at, action, detail) values ('x1', 1, 'auth.sign_in', 'Google')", [], EA);
    await assert.rejects(as(h.pool, "authenticated", A, "update public.klynge_audit_log set detail = 'edited'", [], EA), denied(/permission denied|append-only/));
    await assert.rejects(as(h.pool, "authenticated", A, "insert into public.klynge_audit_log (audit_id, at, action, detail) values ('x2', 1, 'admin.escalate', 'x')", [], EA), denied(/violates check/));
    await assert.rejects(as(h.pool, "authenticated", B, "insert into public.klynge_audit_log (tenant_id, audit_id, at, action, detail) values ($1, 'x3', 1, 'auth.sign_in', 'forged')", [A], EB), denied(/row-level security/));
    assert.equal((await as(h.pool, "authenticated", B, "select * from public.klynge_audit_log", [], EB)).length, 0);
  });
});
