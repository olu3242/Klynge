import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { StateAlert } from "./engine-core.ts";
import { MemoryAccountStore } from "./account/memory-account-store.ts";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "./account/types.ts";
import { composeNotification } from "./notifications/compose.ts";
import { deliverPending, MAX_ATTEMPTS, queueAlertNotification } from "./notifications/dispatcher.ts";
import { MockEmailProvider, ResendEmailProvider } from "./notifications/email.ts";
import { USER_A } from "./test-support.ts";

const alert = (over: Partial<StateAlert> = {}): StateAlert => ({ alertId: "TSLA:DATA:WAIT->CALL_SETUP:1", event: "CALL_SETUP", symbol: "TSLA", evidenceMode: "DATA", from: "WAIT", to: "CALL_SETUP", at: 1_780_000_000_000, severity: "ATTENTION", message: "TSLA: WAIT → CALL_SETUP. Entry zone 102.025–102.183, invalidation 101.867, minimumRewardRiskRatio 2.", ...over });
async function account(enabled = true) {
  const a = new MemoryAccountStore();
  await a.putNotificationPrefs(USER_A, { ...DEFAULT_NOTIFICATION_PREFERENCES, email: { ...DEFAULT_NOTIFICATION_PREFERENCES.email, enabled, address: enabled ? "ada@example.com" : null, minSeverity: "INFO" } }, 0);
  return a;
}

describe("notification content (describes a decision; never a signal, never internals)", () => {
  it("fixed template: event + symbol + mode only; no prices, thresholds, reasons or screenshot text", () => {
    const n = composeNotification(alert());
    assert.match(n.subject, /^Klynge · TSLA: CALL SETUP — conditions met$/);
    for (const leak of ["102.025", "101.867", "minimumRewardRiskRatio", "Entry zone", "buy", "sell"]) assert.ok(!`${n.subject}\n${n.text}`.toLowerCase().includes(leak.toLowerCase()), leak);
    assert.match(n.text, /not financial advice/);
    const visual = composeNotification(alert({ evidenceMode: "VISUAL", event: "VISUAL_CONTEXT_COMPLETE", symbol: "Account 4471 balance $12,345" }));
    assert.ok(!/4471|12,345/.test(visual.subject + visual.text), "untrusted symbol text never echoed");
    assert.match(visual.text, /data verification required/);
  });
});

describe("outbox: opt-in, idempotency, dedupe, rate limit, retry, dead letter", () => {
  it("nothing is queued without opt-in", async () => {
    assert.equal(await queueAlertNotification(await account(false), USER_A, alert(), 1), null);
  });
  it("one alert → one email, even when queued and delivered twice", async () => {
    const a = await account();
    const email = new MockEmailProvider();
    await queueAlertNotification(a, USER_A, alert(), 1);
    await queueAlertNotification(a, USER_A, alert(), 2);
    await deliverPending(a, email, USER_A, 3);
    await deliverPending(a, email, USER_A, 4);
    assert.equal(email.sent.length, 1);
    assert.equal(email.sent[0]!.to, "ada@example.com");
    assert.deepEqual((await a.listOutbox(USER_A)).map((i) => i.status), ["DELIVERED"]);
    assert.ok((await a.listAudit(USER_A)).some((e) => e.action === "notification.delivered"));
  });
  it("repeats of the same symbol+event inside the window are suppressed, not re-sent", async () => {
    const a = await account();
    await queueAlertNotification(a, USER_A, alert(), 1);
    await queueAlertNotification(a, USER_A, alert({ alertId: "TSLA:DATA:WAIT->CALL_SETUP:2" }), 2);
    assert.deepEqual((await a.listOutbox(USER_A)).map((i) => i.status), ["PENDING", "SUPPRESSED"]);
  });
  it("per-user hourly cap defers delivery instead of dropping it", async () => {
    const a = await account();
    await a.putNotificationPrefs(USER_A, { ...(await a.getNotificationPrefs(USER_A))!, maxPerHour: 1 }, 0);
    const email = new MockEmailProvider();
    await queueAlertNotification(a, USER_A, alert(), 1);
    await queueAlertNotification(a, USER_A, alert({ alertId: "TSLA:DATA:CALL_SETUP->INVALIDATED:2", event: "INVALIDATED", severity: "WARNING" }), 2);
    const r = await deliverPending(a, email, USER_A, 3);
    assert.deepEqual([r.delivered, r.deferred, email.sent.length], [1, 1, 1]);
  });
  it("transient failures retry with backoff; permanent failure dead-letters after MAX_ATTEMPTS", async () => {
    const a = await account();
    const email = new MockEmailProvider();
    email.failNext = 1;
    await queueAlertNotification(a, USER_A, alert(), 0);
    await deliverPending(a, email, USER_A, 0);
    const [item] = await a.listOutbox(USER_A);
    assert.deepEqual([item!.status, item!.attempts, item!.nextAttemptAt], ["PENDING", 1, 60_000]);
    await deliverPending(a, email, USER_A, 30_000);
    assert.equal(email.sent.length, 0, "not before the backoff");
    await deliverPending(a, email, USER_A, 60_000);
    assert.equal(email.sent.length, 1);
    const b = await account();
    const down = new MockEmailProvider();
    down.failNext = 99;
    await queueAlertNotification(b, USER_A, alert(), 0);
    for (let t = 0; t < 10 * 3_600_000; t += 600_000) await deliverPending(b, down, USER_A, t);
    const [dead] = await b.listOutbox(USER_A);
    assert.deepEqual([dead!.status, dead!.attempts], ["FAILED", MAX_ATTEMPTS]);
  });
});

describe("Resend adapter contract (offline)", () => {
  it("POST /emails with Bearer key + Idempotency-Key; 429/5xx retryable, 4xx not", async () => {
    const seen: { url: string; headers: Headers; body: string }[] = [];
    let status = 200;
    const f = (async (u: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(u), headers: new Headers(init?.headers), body: String(init?.body) });
      return new Response(JSON.stringify({ id: "msg_1" }), { status });
    }) as typeof fetch;
    const p = new ResendEmailProvider({ apiKey: "re_test_not_real", from: "Klynge <alerts@example.com>", fetch: f });
    assert.deepEqual(await p.send({ to: "ada@example.com", subject: "s", text: "t", idempotencyKey: "k1" }), { ok: true, providerMessageId: "msg_1" });
    assert.equal(seen[0]!.url, "https://api.resend.com/emails");
    assert.equal(seen[0]!.headers.get("authorization"), "Bearer re_test_not_real");
    assert.equal(seen[0]!.headers.get("idempotency-key"), "k1");
    assert.deepEqual(JSON.parse(seen[0]!.body).to, ["ada@example.com"]);
    status = 429;
    assert.equal((await p.send({ to: "a@b.co", subject: "s", text: "t", idempotencyKey: "k2" }) as { retryable: boolean }).retryable, true);
    status = 422;
    assert.equal((await p.send({ to: "a@b.co", subject: "s", text: "t", idempotencyKey: "k3" }) as { retryable: boolean }).retryable, false);
    assert.throws(() => new ResendEmailProvider({ apiKey: "", from: "x" }), /required/);
  });
});
