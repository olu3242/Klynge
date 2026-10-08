import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * SERVICE ROLE ≠ USER AUTHORIZATION.
 * The service-role key bypasses RLS. It may run ONLY these trusted, non-user-request operations, never normal
 * user session CRUD (which uses the user-bound client so RLS executes). Import is restricted by ESLint and a
 * source-scan test to this directory and `scripts/`.
 */
export const SERVICE_ROLE_OPERATIONS = Object.freeze({
  "schema.verify": "Read-only verification of tables, RLS flags and policies after a migration",
  "certification.test-users": "Create/delete dedicated test users for hosted RLS certification",
  "maintenance.cleanup": "Scheduled cleanup of orphaned non-user infrastructure rows",
} as const);

export type ServiceRoleOperation = keyof typeof SERVICE_ROLE_OPERATIONS;

export function isAllowedServiceRoleOperation(op: string): op is ServiceRoleOperation {
  return Object.hasOwn(SERVICE_ROLE_OPERATIONS, op);
}

/** Returns a service-role client for one allow-listed operation. Never logs the key. */
export function serviceRoleClient(op: string, env: Readonly<Record<string, string | undefined>> = process.env): SupabaseClient {
  if (!isAllowedServiceRoleOperation(op)) throw new Error(`service role: operation "${op}" is not allow-listed`);
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("service role: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  console.info(`[service-role] ${op}`);
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
