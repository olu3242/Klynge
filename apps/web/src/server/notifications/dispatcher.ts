import { createHash } from "node:crypto";
import type { AlertSeverity, StateAlert } from "../engine-core.ts";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "../account/types.ts";
import type { AccountStore, AuditAction, OutboxItem } from "../account/types.ts";
import { composeNotification } from "./compose.ts";
import type { EmailProvider } from "./email.ts";

const RANK: Record<AlertSeverity, number> = { INFO: 0, ATTENTION: 1, WARNING: 2 };
export const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000] as const;
export const MAX_ATTEMPTS = 5;
export const DEDUPE_WINDOW_MS = 10 * 60_000;
const id = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);

export async function audit(account: AccountStore, tenantId: string, at: number, action: AuditAction, detail: string): Promise<void> {
  await account.appendAudit({ auditId: id(`${tenantId}|${action}|${at}|${detail}`), tenantId, at, action, detail: detail.slice(0, 160) });
}

/**
 * Queue an email for an alert per the user's opt-in. Idempotent per (alert, channel). Repeats of the same
 * symbol+event inside the dedupe window are recorded as SUPPRESSED (never re-sent).
 */
export async function queueAlertNotification(account: AccountStore, tenantId: string, alert: StateAlert, now: number): Promise<OutboxItem | null> {
  const prefs = (await account.getNotificationPrefs(tenantId)) ?? DEFAULT_NOTIFICATION_PREFERENCES;
  if (!prefs.email.enabled || !prefs.email.address) return null;
  if (prefs.email.events !== "ALL" && !prefs.email.events.includes(alert.event)) return null;
  if (RANK[alert.severity] < RANK[prefs.email.minSeverity]) return null;
  const existing = await account.listOutbox(tenantId);
  const duplicate = existing.some((i) => i.symbol === alert.symbol && i.event === alert.event && i.status !== "SUPPRESSED" && now - i.createdAt < DEDUPE_WINDOW_MS);
  const { subject, text } = composeNotification(alert);
  const item: OutboxItem = {
    notificationId: id(`${tenantId}|${alert.alertId}|email`),
    tenantId,
    alertId: alert.alertId,
    channel: "email",
    event: alert.event,
    symbol: alert.symbol,
    subject,
    text,
    to: prefs.email.address,
    status: duplicate ? "SUPPRESSED" : "PENDING",
    attempts: 0,
    nextAttemptAt: now,
    createdAt: now,
    deliveredAt: null,
    lastError: duplicate ? "duplicate within dedupe window" : null,
  };
  const created = await account.enqueue(item);
  if (created && duplicate) await audit(account, tenantId, now, "notification.suppressed", `${alert.event} ${alert.symbol}`);
  return created ? item : null;
}

/** Deliver due items with retry/backoff, a per-user hourly cap and a dead-letter state. */
export async function deliverPending(account: AccountStore, email: EmailProvider, tenantId: string, now: number): Promise<{ delivered: number; failed: number; deferred: number }> {
  const prefs = (await account.getNotificationPrefs(tenantId)) ?? DEFAULT_NOTIFICATION_PREFERENCES;
  const items = await account.listOutbox(tenantId);
  let sentLastHour = items.filter((i) => i.status === "DELIVERED" && i.deliveredAt !== null && now - i.deliveredAt < 3_600_000).length;
  let delivered = 0;
  let failed = 0;
  let deferred = 0;
  for (const item of items.filter((i) => i.status === "PENDING" && i.nextAttemptAt <= now)) {
    if (sentLastHour >= prefs.maxPerHour) {
      await account.updateOutbox({ ...item, nextAttemptAt: now + 15 * 60_000, lastError: "hourly notification limit reached" });
      deferred++;
      continue;
    }
    const r = await email.send({ to: item.to, subject: item.subject, text: item.text, idempotencyKey: item.notificationId });
    if (r.ok) {
      await account.updateOutbox({ ...item, status: "DELIVERED", attempts: item.attempts + 1, deliveredAt: now, lastError: null });
      await audit(account, tenantId, now, "notification.delivered", `${item.event} ${item.symbol}`);
      sentLastHour++;
      delivered++;
      continue;
    }
    const attempts = item.attempts + 1;
    const dead = !r.retryable || attempts >= MAX_ATTEMPTS;
    await account.updateOutbox({ ...item, attempts, status: dead ? "FAILED" : "PENDING", nextAttemptAt: dead ? item.nextAttemptAt : now + (BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)] as number), lastError: r.error });
    if (dead) {
      await audit(account, tenantId, now, "notification.failed", `${item.event} ${item.symbol}`);
      failed++;
    } else deferred++;
  }
  return { delivered, failed, deferred };
}
