import type { AlertEvent, AlertSeverity, PolicyVeto, UserRiskPolicy } from "../engine-core.ts";

/**
 * Account-scoped durable records, kept SEPARATE from engine decisions:
 *   preferences (user policy, notification prefs) · policy verdicts/vetoes · notification outbox · audit log.
 * Only verified users have an AccountStore (anonymous trials never do).
 */
export interface PolicyVerdictRecord {
  recordId: string;
  tenantId: string;
  at: number;
  engineDecision: string;
  withinUserPolicy: boolean;
  vetoes: PolicyVeto[];
  policyVersion: number;
}

export interface NotificationPreferences {
  version: 1;
  /** In-app notifications are always on (they are the alert list). */
  email: {
    enabled: boolean;
    /** Snapshot of the VERIFIED auth email at opt-in time — never user-typed. */
    address: string | null;
    events: AlertEvent[] | "ALL";
    minSeverity: AlertSeverity;
  };
  /** Delivery cap per rolling hour (email). */
  maxPerHour: number;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: Readonly<NotificationPreferences> = Object.freeze({ version: 1 as const, email: { enabled: false, address: null, events: "ALL" as const, minSeverity: "ATTENTION" as const }, maxPerHour: 6 });

export type DeliveryStatus = "PENDING" | "DELIVERED" | "FAILED" | "SUPPRESSED";

export interface OutboxItem {
  /** Idempotency key: hash(tenantId|alertId|channel) — also the provider idempotency key, so it must be per tenant. */
  notificationId: string;
  tenantId: string;
  alertId: string;
  channel: "email";
  event: AlertEvent;
  symbol: string;
  subject: string;
  text: string;
  to: string;
  status: DeliveryStatus;
  attempts: number;
  nextAttemptAt: number;
  createdAt: number;
  deliveredAt: number | null;
  lastError: string | null;
}

export type AuditAction =
  | "auth.sign_in"
  | "auth.sign_out"
  | "session.promoted"
  | "policy.updated"
  | "notifications.updated"
  | "notification.delivered"
  | "notification.failed"
  | "notification.suppressed"
  | "data.connected"
  | "ops.recovered";

export interface AuditEntry {
  auditId: string;
  tenantId: string;
  at: number;
  action: AuditAction;
  /** Short, non-sensitive detail (never tokens, emails, notes, images or thresholds). */
  detail: string;
}

export interface AccountStore {
  getPolicy(tenantId: string): Promise<UserRiskPolicy | null>;
  putPolicy(tenantId: string, policy: UserRiskPolicy, at: number): Promise<void>;
  putVerdict(v: PolicyVerdictRecord): Promise<boolean>;
  listVerdicts(tenantId: string): Promise<PolicyVerdictRecord[]>;
  getNotificationPrefs(tenantId: string): Promise<NotificationPreferences | null>;
  putNotificationPrefs(tenantId: string, prefs: NotificationPreferences, at: number): Promise<void>;
  enqueue(item: OutboxItem): Promise<boolean>;
  updateOutbox(item: OutboxItem): Promise<void>;
  listOutbox(tenantId: string): Promise<OutboxItem[]>;
  appendAudit(e: AuditEntry): Promise<boolean>;
  listAudit(tenantId: string, limit?: number): Promise<AuditEntry[]>;
}
