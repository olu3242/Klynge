import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { StateAlert } from "./engine-core.ts";
import { MemoryAccountStore } from "./account/memory-account-store.ts";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "./account/types.ts";
import { BACKOFF_MS, MAX_ATTEMPTS, queueAlertNotification } from "./notifications/dispatcher.ts";
import { MockEmailProvider } from "./notifications/email.ts";
import type { EmailMessage, EmailProvider } from "./notifications/email.ts";
import { HOURLY_DEFER_MS, MemoryNotificationQueue, runNotificationWorker } from "./notifications/worker.ts";
import { USER_A, USER_B } from "./test-support.ts";

const T0 = 1_780_000_000_000;
const alert = (n: number, symbol = "TSLA"): StateAlert => ({ alertId: `${symbol}:DATA:WAIT->CALL_SETUP:${n}`, event: "CALL_SETUP", symbol, evidenceMode: "DATA", from: "WAIT", to: "CALL_SETUP", at: T0 + n, severity: "ATTENTION", message: "x" });
async function setup(count = 1, maxPerHour = 6) {
  const a = new MemoryAccountStore();
  for (const [u, addr] of [[USER_A, "ada@example.com"], [USER_B, "bob@example.com"]] as const) await a.putNotificationPrefs(u, { ...DEFAULT_NOTIFICATION_PREFERENCES, maxPerHour, email: { ...DEFAULT_NOTIFICATION_PREFERENCES.email, enabled: true, address: addr, minSeverity: "INFO" } }, 0);
  // Distinct symbols so the 10-minute dedupe window does not suppress them.
  for (let i = 0; i < count; i++) await queueAlertNotification(a, i % 2 ? USER_B : USER_A, alert(i, `S${i}`), T0);
  return { a, q: new MemoryNotificationQueue(a) };
}
/** Slow provider: lets two workers overlap in time. */
class SlowEmail implements EmailProvider {
  readonly id = "slow";
  readonly inner = new MockEmailProvider();
  calls = 0;
  async send(m: EmailMessage) {
    this.calls++;
    await new Promise((r) => setTimeout(r, 5));
    return this.inner.send(m);
  }
}
const all = (a: MemoryAccountStore) => a.allOutbox();

describe("notification worker (Batch 67, in-process queue)", () => {
  it("delivers due items once, audits, and records a run without addresses or content", async () => {
    const { a, q } = await setup(3);
    const email = new MockEmailProvider();
    const run = await runNotificationWorker(q, email, { workerId: "w1", now: T0 + 1 });
    assert.deepEqual([run.claimed, run.delivered, run.failed, run.leaseLost], [3, 3, 0, 0]);
    assert.equal(email.sent.length, 3);
    assert.ok(all(a).every((i) => i.status === "DELIVERED" && i.attempts === 1));
    assert.equal((await a.listAudit(USER_A)).filter((e) => e.action === "notification.delivered").length, 2);
    assert.doesNotMatch(JSON.stringify(q.runs), /@example\.com|Klynge ·/);
    assert.equal((await runNotificationWorker(q, email, { workerId: "w1", now: T0 + 2 })).claimed, 0, "idempotent re-run");
  });
  it("overlapping workers never claim or deliver the same row", async () => {
    const { a, q } = await setup(8, 100);
    const email = new SlowEmail();
    const [r1, r2] = await Promise.all([runNotificationWorker(q, email, { workerId: "w1", now: T0 + 1, batch: 5 }), runNotificationWorker(q, email, { workerId: "w2", now: T0 + 1, batch: 5 })]);
    assert.equal(r1.claimed + r2.claimed, 8);
    assert.equal(email.calls, 8, "each row sent exactly once");
    assert.equal(new Set(email.inner.sent.map((m) => m.idempotencyKey)).size, 8);
    assert.ok(all(a).every((i) => i.status === "DELIVERED"));
  });
  it("transient failure → backoff; repeated failure → dead letter (FAILED) with audit", async () => {
    const { a, q } = await setup(1);
    const email = new MockEmailProvider();
    email.failNext = 1;
    const r = await runNotificationWorker(q, email, { workerId: "w1", now: T0 + 1 });
    assert.equal(r.deferred, 1);
    const [item] = all(a);
    assert.deepEqual([item!.status, item!.attempts, item!.nextAttemptAt], ["PENDING", 1, T0 + 1 + BACKOFF_MS[0]]);
    assert.equal((await runNotificationWorker(q, email, { workerId: "w1", now: T0 + 2 })).claimed, 0, "not due before backoff");
    email.failNext = 99;
    let t = T0 + 1;
    for (let k = 0; k < MAX_ATTEMPTS; k++) await runNotificationWorker(q, email, { workerId: "w1", now: (t += 3 * 3_600_000) });
    assert.equal(all(a)[0]!.status, "FAILED");
    assert.equal(all(a)[0]!.attempts, MAX_ATTEMPTS);
    assert.ok((await a.listAudit(USER_A)).some((e) => e.action === "notification.failed"));
  });
  it("per-user hourly cap defers; it never drops", async () => {
    const { a, q } = await setup(6, 1);
    const r = await runNotificationWorker(q, new MockEmailProvider(), { workerId: "w1", now: T0 + 1 });
    assert.equal(r.delivered, 2, "one per user");
    assert.equal(r.deferred, 4);
    assert.ok(all(a).filter((i) => i.status === "PENDING").every((i) => i.nextAttemptAt === T0 + 1 + HOURLY_DEFER_MS));
  });
  it("a recipient that no longer matches the verified preference is suppressed, never sent", async () => {
    const { a, q } = await setup(1);
    await a.putNotificationPrefs(USER_A, { ...DEFAULT_NOTIFICATION_PREFERENCES, email: { ...DEFAULT_NOTIFICATION_PREFERENCES.email, enabled: true, address: "new@example.com" } }, 1);
    const email = new MockEmailProvider();
    const r = await runNotificationWorker(q, email, { workerId: "w1", now: T0 + 1 });
    assert.deepEqual([r.suppressed, email.sent.length, all(a)[0]!.status], [1, 0, "SUPPRESSED"]);
  });
  it("crash after claim: the lease blocks others until expiry, then a new worker recovers the row", async () => {
    const { a, q } = await setup(1);
    await q.claim("crashed", T0 + 1, 60_000, 10);
    const email = new MockEmailProvider();
    assert.equal((await runNotificationWorker(q, email, { workerId: "w2", now: T0 + 30_000 })).claimed, 0);
    const r = await runNotificationWorker(q, email, { workerId: "w2", now: T0 + 61_001 });
    assert.equal(r.delivered, 1);
    assert.equal(all(a)[0]!.status, "DELIVERED");
  });
  it("crash after send: the stale worker's completion is fenced and the provider idempotency key prevents a second email", async () => {
    const { a, q } = await setup(1);
    const email = new MockEmailProvider();
    const [stale] = await q.claim("w1", T0 + 1, 60_000, 10);
    await email.send({ to: stale!.to, subject: stale!.subject, text: stale!.text, idempotencyKey: stale!.notificationId });
    const r = await runNotificationWorker(q, email, { workerId: "w2", now: T0 + 61_001 });
    assert.equal(r.delivered, 1);
    assert.equal(await q.complete({ ...stale!, status: "FAILED" }, "w1"), false, "lost lease cannot overwrite");
    assert.equal(email.sent.length, 1, "exactly one email reached the provider");
    assert.equal(all(a)[0]!.status, "DELIVERED");
  });
  it("a run that exceeds its lease budget releases unprocessed rows instead of acting on an expired lease", async () => {
    const { a, q } = await setup(3);
    let t = T0 + 1;
    const r = await runNotificationWorker(q, new MockEmailProvider(), { workerId: "w1", now: T0 + 1, leaseMs: 10_000, clock: () => (t += 5_000) });
    assert.equal(r.delivered + r.deferred, 3);
    assert.ok(r.deferred >= 1);
    assert.ok(all(a).filter((i) => i.status === "PENDING").every((i) => i.attempts === 0), "released rows are untouched");
    assert.equal((await q.claim("w2", T0 + 2, 10_000, 10)).length, all(a).filter((i) => i.status === "PENDING").length, "released rows are immediately claimable");
  });
});

describe("idempotency keys are per tenant (defect found by the Batch 70 pilot journey)", () => {
  it("the same alert for two users yields two distinct provider idempotency keys; both are delivered", async () => {
    const a = new MemoryAccountStore();
    for (const [u, addr] of [[USER_A, "ada@example.com"], [USER_B, "bob@example.com"]] as const) await a.putNotificationPrefs(u, { ...DEFAULT_NOTIFICATION_PREFERENCES, email: { ...DEFAULT_NOTIFICATION_PREFERENCES.email, enabled: true, address: addr, minSeverity: "INFO" } }, 0);
    const same = alert(1);
    const x = await queueAlertNotification(a, USER_A, same, T0);
    const y = await queueAlertNotification(a, USER_B, same, T0);
    assert.notEqual(x!.notificationId, y!.notificationId);
    const email = new MockEmailProvider();
    await runNotificationWorker(new MemoryNotificationQueue(a), email, { workerId: "w", now: T0 + 1 });
    assert.deepEqual(email.sent.map((m) => m.to).sort(), ["ada@example.com", "bob@example.com"]);
  });
});
