import { createHash } from "node:crypto";
import type { MemoryAccountStore } from "../account/memory-account-store.ts";
import type { AuditAction, AuditEntry, NotificationPreferences, OutboxItem } from "../account/types.ts";
import { BACKOFF_MS, MAX_ATTEMPTS } from "./dispatcher.ts";
import type { EmailProvider } from "./email.ts";

/**
 * Notification worker (Batch 67). Claims due outbox rows under a time-boxed lease, delivers with retries/backoff, a
 * per-user hourly cap and a dead-letter state, and completes each row with a FENCED write (only the lease owner can
 * record an outcome). Overlapping workers never claim the same row (SKIP LOCKED in SQL, a lease map in memory); a
 * worker that crashes after sending is covered by the provider idempotency key (notificationId).
 * Logs and run records never contain recipient addresses or message content.
 */
export interface NotificationQueue {
  readonly kind: "memory" | "rpc";
  claim(workerId: string, now: number, leaseMs: number, limit: number): Promise<OutboxItem[]>;
  /** false = lease lost (another worker owns the row now, or it is no longer PENDING). */
  complete(item: OutboxItem, workerId: string): Promise<boolean>;
  context(tenantId: string, since: number): Promise<{ prefs: NotificationPreferences | null; deliveredSince: number }>;
  audit(e: AuditEntry): Promise<void>;
  recordRun(r: WorkerRun): Promise<void>;
}

export interface WorkerRun {
  runId: string;
  workerId: string;
  startedAt: number;
  finishedAt: number;
  claimed: number;
  delivered: number;
  failed: number;
  deferred: number;
  suppressed: number;
  leaseLost: number;
}

export const DEFAULT_LEASE_MS = 120_000;
export const HOURLY_DEFER_MS = 15 * 60_000;
const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);

export async function runNotificationWorker(q: NotificationQueue, email: EmailProvider, o: { workerId: string; now: number; clock?: () => number; leaseMs?: number; batch?: number }): Promise<WorkerRun> {
  const leaseMs = o.leaseMs ?? DEFAULT_LEASE_MS;
  const clock = o.clock ?? (() => o.now);
  const now = o.now;
  const run: WorkerRun = { runId: hash(`${o.workerId}|${now}`), workerId: o.workerId, startedAt: now, finishedAt: now, claimed: 0, delivered: 0, failed: 0, deferred: 0, suppressed: 0, leaseLost: 0 };
  const items = await q.claim(o.workerId, now, leaseMs, o.batch ?? 50);
  run.claimed = items.length;
  const ctx = new Map<string, { prefs: NotificationPreferences | null; sent: number }>();
  const audit = (item: OutboxItem, action: AuditAction) => q.audit({ auditId: hash(`${item.tenantId}|${action}|${item.notificationId}`), tenantId: item.tenantId, at: now, action, detail: `${item.event} ${item.symbol}`.slice(0, 160) });
  const finish = async (next: OutboxItem, counter: "delivered" | "failed" | "deferred" | "suppressed", action?: AuditAction) => {
    if (!(await q.complete(next, o.workerId))) {
      run.leaseLost++;
      return;
    }
    run[counter]++;
    if (action) await audit(next, action);
  };
  for (const item of items) {
    // Never act on a lease that may already have expired: release the rest untouched for the next run.
    if (clock() - now > leaseMs * 0.8) {
      await finish({ ...item }, "deferred");
      continue;
    }
    let c = ctx.get(item.tenantId);
    if (!c) {
      const k = await q.context(item.tenantId, now - 3_600_000);
      c = { prefs: k.prefs, sent: k.deliveredSince };
      ctx.set(item.tenantId, c);
    }
    if (!c.prefs?.email.enabled || c.prefs.email.address !== item.to) {
      await finish({ ...item, status: "SUPPRESSED", lastError: "notification preferences changed" }, "suppressed", "notification.suppressed");
      continue;
    }
    if (c.sent >= c.prefs.maxPerHour) {
      await finish({ ...item, nextAttemptAt: now + HOURLY_DEFER_MS, lastError: "hourly notification limit reached" }, "deferred");
      continue;
    }
    const r = await email.send({ to: item.to, subject: item.subject, text: item.text, idempotencyKey: item.notificationId });
    const attempts = item.attempts + 1;
    if (r.ok) {
      c.sent++;
      await finish({ ...item, status: "DELIVERED", attempts, deliveredAt: now, lastError: null }, "delivered", "notification.delivered");
      continue;
    }
    const dead = !r.retryable || attempts >= MAX_ATTEMPTS;
    if (dead) await finish({ ...item, status: "FAILED", attempts, lastError: r.error }, "failed", "notification.failed");
    else await finish({ ...item, attempts, nextAttemptAt: now + (BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)] as number), lastError: r.error }, "deferred");
  }
  run.finishedAt = Math.max(now, clock());
  await q.recordRun(run);
  return run;
}

/** In-process queue over the memory/file account store (single process; leases are in memory). */
export class MemoryNotificationQueue implements NotificationQueue {
  readonly kind = "memory" as const;
  readonly runs: WorkerRun[] = [];
  private readonly leases = new Map<string, { owner: string; expires: number }>();
  private readonly account: MemoryAccountStore;
  constructor(account: MemoryAccountStore) {
    this.account = account;
  }
  private key = (i: OutboxItem) => `${i.tenantId}\u0000${i.notificationId}`;
  async claim(workerId: string, now: number, leaseMs: number, limit: number) {
    const due = this.account
      .allOutbox()
      .filter((i) => i.status === "PENDING" && i.nextAttemptAt <= now && (this.leases.get(this.key(i))?.expires ?? 0) <= now)
      .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt || a.createdAt - b.createdAt || a.notificationId.localeCompare(b.notificationId))
      .slice(0, limit);
    for (const i of due) this.leases.set(this.key(i), { owner: workerId, expires: now + leaseMs });
    return due.map((i) => ({ ...i }));
  }
  async complete(item: OutboxItem, workerId: string) {
    const current = this.account.allOutbox().find((i) => this.key(i) === this.key(item));
    if (!current || current.status !== "PENDING" || this.leases.get(this.key(item))?.owner !== workerId || current.to !== item.to) return false;
    this.leases.delete(this.key(item));
    await this.account.updateOutbox(item);
    return true;
  }
  async context(tenantId: string, since: number) {
    const items = await this.account.listOutbox(tenantId);
    return { prefs: await this.account.getNotificationPrefs(tenantId), deliveredSince: items.filter((i) => i.status === "DELIVERED" && (i.deliveredAt ?? 0) >= since).length };
  }
  async audit(e: AuditEntry) {
    await this.account.appendAudit(e);
  }
  async recordRun(r: WorkerRun) {
    this.runs.push({ ...r });
  }
}

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<Record<string, unknown>[]>;
type Insert = (table: "klynge_audit_log" | "klynge_worker_runs", row: Record<string, unknown>) => Promise<void>;

/** Hosted queue: migration 0003 functions (service_role only). Works over PostgREST rpc or a direct SQL adapter. */
export class RpcNotificationQueue implements NotificationQueue {
  readonly kind = "rpc" as const;
  private readonly rpc: Rpc;
  private readonly insert: Insert;
  constructor(rpc: Rpc, insert: Insert) {
    this.rpc = rpc;
    this.insert = insert;
  }
  async claim(workerId: string, now: number, leaseMs: number, limit: number) {
    const rows = await this.rpc("klynge_claim_notifications", { p_worker: workerId, p_now: now, p_lease_ms: leaseMs, p_limit: limit });
    return rows.map((r) => ({ ...(r.payload as OutboxItem), tenantId: String(r.tenant_id), status: r.status as OutboxItem["status"], nextAttemptAt: Number(r.next_attempt_at) }));
  }
  async complete(item: OutboxItem, workerId: string) {
    const rows = await this.rpc("klynge_complete_notification", { p_tenant: item.tenantId, p_notification: item.notificationId, p_worker: workerId, p_status: item.status, p_next_attempt_at: item.nextAttemptAt, p_payload: item });
    const v = rows[0];
    return v !== undefined && Object.values(v)[0] === true;
  }
  async context(tenantId: string, since: number) {
    const r = (await this.rpc("klynge_notification_context", { p_tenant: tenantId, p_since: since }))[0] ?? {};
    return { prefs: (r.prefs as NotificationPreferences | null) ?? null, deliveredSince: Number(r.delivered_since ?? 0) };
  }
  async audit(e: AuditEntry) {
    await this.insert("klynge_audit_log", { tenant_id: e.tenantId, audit_id: e.auditId, at: e.at, action: e.action, detail: e.detail });
  }
  async recordRun(r: WorkerRun) {
    await this.insert("klynge_worker_runs", { run_id: r.runId, worker_id: r.workerId, started_at: r.startedAt, finished_at: r.finishedAt, claimed: r.claimed, delivered: r.delivered, failed: r.failed, deferred: r.deferred, suppressed: r.suppressed, lease_lost: r.leaseLost });
  }
}
