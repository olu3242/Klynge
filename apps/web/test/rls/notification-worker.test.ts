import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MockEmailProvider } from "../../src/server/notifications/email.ts";
import { RpcNotificationQueue, runNotificationWorker } from "../../src/server/notifications/worker.ts";
import { as, startPostgres } from "./pg-harness.ts";
import type { Harness } from "./pg-harness.ts";

/** Migration 0003 (hosted notification worker) on local PostgreSQL. SYNTHETIC rows; no provider is called. */
const A = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb";
const U = "cccccccc-cccc-4ccc-accc-cccccccccccc"; // unconfirmed email
const T0 = 1_780_000_000_000;
let h: Harness;

const item = (tenant: string, id: string, to: string) => ({ notificationId: id, tenantId: tenant, alertId: `al-${id}`, channel: "email", event: "CALL_SETUP", symbol: "TSLA", subject: "Klynge · TSLA", text: "body", to, status: "PENDING", attempts: 0, nextAttemptAt: T0, createdAt: T0, deliveredAt: null, lastError: null });
async function enqueue(tenant: string, id: string, to: string) {
  await as(h.pool, "authenticated", tenant, "insert into public.klynge_notification_outbox (notification_id, status, next_attempt_at, payload) values ($1, 'PENDING', $2, $3)", [id, T0, JSON.stringify(item(tenant, id, to))], { email: to });
}
const queue = () =>
  new RpcNotificationQueue(
    async (fn, args) => {
      const keys = Object.keys(args);
      return as(h.pool, "service_role", null, `select * from public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`, keys.map((k) => (typeof args[k] === "object" && args[k] !== null ? JSON.stringify(args[k]) : args[k])));
    },
    async (table, row) => {
      const keys = Object.keys(row);
      await as(h.pool, "service_role", null, `insert into public.${table} (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")})`, Object.values(row));
    },
  );
const statuses = async () => (await h.pool.query("select notification_id, status, lease_owner from public.klynge_notification_outbox order by notification_id")).rows;

before(async () => {
  h = await startPostgres({ migrations: "all" });
  await h.pool.query("insert into auth.users (id, email, email_confirmed_at) values ($1, 'a@example.com', now()), ($2, 'b@example.com', now()), ($3, 'u@example.com', null)", [A, B, U]);
  for (const [u, e] of [[A, "a@example.com"], [B, "b@example.com"]] as const) {
    await as(h.pool, "authenticated", u, "insert into public.klynge_notification_prefs (payload) values ($1)", [JSON.stringify({ version: 1, email: { enabled: true, address: e, events: "ALL", minSeverity: "INFO" }, maxPerHour: 50 })], { email: e });
  }
});
after(async () => h?.stop());

describe("migration 0003 — notification worker (local PostgreSQL)", () => {
  it("API roles cannot execute worker functions or read worker runs", async () => {
    for (const role of ["anon", "authenticated"] as const) {
      await assert.rejects(as(h.pool, role, role === "anon" ? null : A, "select * from public.klynge_claim_notifications('x', 0, 60000, 10)", [], { email: "a@example.com" }), /permission denied/);
      await assert.rejects(as(h.pool, role, role === "anon" ? null : A, "select * from public.klynge_worker_runs", [], { email: "a@example.com" }), /permission denied/);
    }
    const r = await h.pool.query("select has_function_privilege('service_role', 'public.klynge_claim_notifications(text, bigint, bigint, int)', 'execute') as s");
    assert.equal(r.rows[0].s, true);
  });
  it("concurrent claims (overlapping transactions) are disjoint: FOR UPDATE SKIP LOCKED", async () => {
    for (let i = 0; i < 6; i++) await enqueue(i % 2 ? B : A, `c-0000000${i}`, i % 2 ? "b@example.com" : "a@example.com");
    const c1 = await h.pool.connect();
    const c2 = await h.pool.connect();
    try {
      for (const c of [c1, c2]) await c.query("begin; set local role service_role");
      const r1 = await c1.query("select notification_id from public.klynge_claim_notifications('w1', $1, 60000, 4)", [T0 + 1]);
      const r2 = await c2.query("select notification_id from public.klynge_claim_notifications('w2', $1, 60000, 4)", [T0 + 1]);
      await c1.query("commit");
      await c2.query("commit");
      const a = r1.rows.map((x) => x.notification_id);
      const b = r2.rows.map((x) => x.notification_id);
      assert.equal(a.length, 4);
      assert.equal(b.length, 2);
      assert.equal(new Set([...a, ...b]).size, 6, "no row claimed twice");
    } finally {
      c1.release();
      c2.release();
    }
    assert.equal((await queue().claim("w3", T0 + 2, 60_000, 10)).length, 0, "leased rows are not re-claimable before expiry");
  });
  it("completion is fenced to the lease owner; recipient and identity are immutable", async () => {
    const q = queue();
    const [row] = await q.claim("w4", T0 + 61_000, 60_000, 1);
    assert.ok(row);
    assert.equal(await q.complete({ ...row, status: "DELIVERED", deliveredAt: T0 }, "intruder"), false);
    assert.equal(await q.complete({ ...row, status: "DELIVERED", to: "victim@example.com" }, "w4"), false);
    assert.equal(await q.complete({ ...row, status: "DELIVERED", attempts: 1, deliveredAt: T0 + 61_000 }, "w4"), true);
    assert.equal(await q.complete({ ...row, status: "FAILED" }, "w4"), false, "terminal rows cannot be rewritten");
  });
  it("end-to-end worker over the SQL functions: expired leases recovered, one email per row, audit + run log", async () => {
    const email = new MockEmailProvider();
    const run = await runNotificationWorker(queue(), email, { workerId: "w5", now: T0 + 200_000 });
    assert.equal(run.delivered, 5);
    assert.equal(email.sent.length, 5);
    assert.ok((await statuses()).every((r) => r.status === "DELIVERED" && r.lease_owner === null));
    const audit = await h.pool.query("select count(*)::int as n from public.klynge_audit_log where action = 'notification.delivered'");
    assert.equal(audit.rows[0].n, 5);
    const runs = await h.pool.query("select worker_id, delivered from public.klynge_worker_runs");
    assert.deepEqual(runs.rows, [{ worker_id: "w5", delivered: 5 }]);
    assert.equal((await as(h.pool, "authenticated", A, "select count(*)::int as n from public.klynge_notification_outbox", [], { email: "a@example.com" }))[0]!.n, 3, "users still see only their own rows");
  });
  it("an unconfirmed or changed recipient is suppressed at claim time and never handed to a worker", async () => {
    await enqueue(U, "u-00000001", "u@example.com");
    await enqueue(A, "a-00000099", "a@example.com");
    await h.pool.query("update auth.users set email = 'a2@example.com' where id = $1", [A]);
    const claimed = await queue().claim("w6", T0 + 300_000, 60_000, 10);
    assert.deepEqual(claimed, []);
    const r = await h.pool.query("select notification_id, status, payload ->> 'lastError' as e from public.klynge_notification_outbox where notification_id in ('u-00000001', 'a-00000099') order by 1");
    assert.deepEqual(r.rows.map((x) => x.status), ["SUPPRESSED", "SUPPRESSED"]);
    assert.match(r.rows[0].e, /confirmed account email/);
  });
  it("claim input is bounded", async () => {
    await assert.rejects(as(h.pool, "service_role", null, "select * from public.klynge_claim_notifications('w', 0, 999999999, 10)"), /out of range/);
  });
});
