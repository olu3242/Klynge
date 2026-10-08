import { DEFAULT_USER_RISK_POLICY, validateUserRiskPolicy } from "./engine-core.ts";
import type { AlertEvent, AlertSeverity, UserRiskPolicy } from "./engine-core.ts";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "./account/types.ts";
import type { AccountStore, NotificationPreferences } from "./account/types.ts";
import { audit } from "./notifications/dispatcher.ts";
import { WorkspaceError } from "./workspace.ts";

export interface SettingsView {
  riskPolicy: UserRiskPolicy;
  notifications: { emailEnabled: boolean; emailAddress: string | null; events: AlertEvent[] | "ALL"; minSeverity: AlertSeverity; maxPerHour: number };
}

const EVENTS: readonly AlertEvent[] = ["VISUAL_CONTEXT_COMPLETE", "VISUAL_CONTEXT_INCOMPLETE", "DATA_VERIFIED", "RISK_ON", "RISK_OFF", "MIXED", "SETUP_WAIT", "CALL_SETUP", "PUT_SETUP", "BLOCKED", "INVALIDATED", "OPTIONS_ELIGIBLE", "OPTIONS_BLOCKED", "PROVIDER_FAILURE"];
const SEVERITIES: readonly AlertSeverity[] = ["INFO", "ATTENTION", "WARNING"];

function requireAccount(account: AccountStore | null | undefined): AccountStore {
  if (!account) throw new WorkspaceError("AUTH_REQUIRED", "Sign in to manage your settings.");
  return account;
}

export async function getSettings(account: AccountStore | null | undefined, tenantId: string): Promise<SettingsView> {
  const a = requireAccount(account);
  const p = (await a.getNotificationPrefs(tenantId)) ?? DEFAULT_NOTIFICATION_PREFERENCES;
  return { riskPolicy: (await a.getPolicy(tenantId)) ?? { ...DEFAULT_USER_RISK_POLICY }, notifications: { emailEnabled: p.email.enabled, emailAddress: p.email.address, events: p.email.events, minSeverity: p.email.minSeverity, maxPerHour: p.maxPerHour } };
}

/** Preferences only restrict. The email address is ALWAYS the verified auth email (never a typed address). */
export async function updateSettings(account: AccountStore | null | undefined, tenantId: string, verifiedEmail: string | null, input: unknown, now: number): Promise<SettingsView> {
  const a = requireAccount(account);
  const body = (input ?? {}) as { riskPolicy?: unknown; notifications?: Record<string, unknown> };
  if (body.riskPolicy !== undefined) {
    const v = validateUserRiskPolicy(body.riskPolicy);
    if ("errors" in v) throw new WorkspaceError("INVALID", v.errors[0] ?? "Invalid risk policy");
    await a.putPolicy(tenantId, v.policy, now);
    await audit(a, tenantId, now, "policy.updated", "risk preferences updated");
  }
  if (body.notifications !== undefined) {
    const n = body.notifications;
    const enabled = n.emailEnabled === true;
    if (enabled && !verifiedEmail) throw new WorkspaceError("INVALID", "Your account has no verified email address");
    const events = n.events === undefined || n.events === "ALL" ? "ALL" : Array.isArray(n.events) && n.events.every((e) => EVENTS.includes(e as AlertEvent)) ? [...new Set(n.events as AlertEvent[])] : null;
    const minSeverity = (n.minSeverity ?? "ATTENTION") as AlertSeverity;
    const maxPerHour = n.maxPerHour === undefined ? DEFAULT_NOTIFICATION_PREFERENCES.maxPerHour : Number(n.maxPerHour);
    if (!events || !SEVERITIES.includes(minSeverity) || !Number.isInteger(maxPerHour) || maxPerHour < 1 || maxPerHour > 30) throw new WorkspaceError("INVALID", "Invalid notification preferences");
    const prefs: NotificationPreferences = { version: 1, email: { enabled, address: enabled ? verifiedEmail : null, events, minSeverity }, maxPerHour };
    await a.putNotificationPrefs(tenantId, prefs, now);
    await audit(a, tenantId, now, "notifications.updated", enabled ? "email notifications on" : "email notifications off");
  }
  return getSettings(a, tenantId);
}
