import type { MemoryAccountStore } from "./memory-account-store.ts";
import { audit } from "../notifications/dispatcher.ts";
import { evidenceLedger } from "../pilot/evidence.ts";
import type { MemoryPilotStore } from "../pilot/memory-pilot-store.ts";
import type { MemoryImageStore, MemorySessionStore } from "../store/memory-store.ts";
import type { WorkspaceDeps } from "../workspace.ts";
import { WorkspaceError } from "../workspace.ts";

/**
 * Account-data privacy controls (Batch 77). Export returns ONLY the verified user's own rows (user-bound stores; RLS in
 * Supabase mode) — never images (processed images are not persisted), never other tenants, never secrets. Deletion
 * removes every in-process row owned by the user; on Supabase, decision/journal rows are append-only for users, so
 * deletion is the operator procedure in docs/runbooks/account-deletion.md (auth user deletion cascades).
 */
export const DELETE_CONFIRMATION = "DELETE MY DATA";

export async function exportAccount(deps: WorkspaceDeps, tenantId: string, email: string | null, now: number) {
  const records = await deps.store.listRecords(tenantId);
  const sessionIds = [...new Set(records.map((r) => r.sessionId))];
  const sessions = (await Promise.all(sessionIds.map((id) => deps.store.getSession(tenantId, id)))).filter(Boolean);
  const account = deps.account;
  const pilot = deps.pilot;
  const out = {
    exportVersion: "account-export-v1",
    exportedAt: now,
    account: { email },
    sessions,
    decisions: records,
    evidence: evidenceLedger(records),
    journal: await deps.store.listJournal(tenantId),
    alerts: await deps.store.listAlerts(tenantId),
    riskPolicy: account ? await account.getPolicy(tenantId) : null,
    policyVerdicts: account ? await account.listVerdicts(tenantId) : [],
    notificationPreferences: account ? await account.getNotificationPrefs(tenantId) : null,
    notifications: account ? (await account.listOutbox(tenantId)).map(({ text: _t, ...o }) => o) : [],
    auditLog: account ? await account.listAudit(tenantId, 1000) : [],
    pilot: pilot ? { enrollment: await pilot.getEnrollment(tenantId), onboarding: await pilot.getOnboarding(tenantId), feedback: await pilot.listFeedback(tenantId) } : null,
    notes: ["Chart images are never persisted, so none are included.", "Klynge is not financial advice."],
  };
  if (account) await audit(account, tenantId, now, "account.exported", `${records.length} decisions`);
  return out;
}

export interface InProcessStores {
  durable: MemorySessionStore | null;
  account: MemoryAccountStore | null;
  pilot: MemoryPilotStore | null;
  images: MemoryImageStore;
}

export function deleteAccount(stores: InProcessStores, tenantId: string, confirmation: unknown): { deleted: number } {
  if (confirmation !== DELETE_CONFIRMATION) throw new WorkspaceError("INVALID", `Type "${DELETE_CONFIRMATION}" to confirm deletion.`);
  if (!stores.durable) throw new WorkspaceError("INVALID", "Hosted accounts are deleted by the pilot team on request (docs/runbooks/account-deletion.md).");
  const deleted = stores.durable.purgeTenant(tenantId) + (stores.account?.purgeTenant(tenantId) ?? 0) + (stores.pilot?.purgeTenant(tenantId) ?? 0) + stores.images.purgeTenant(tenantId);
  return { deleted };
}
