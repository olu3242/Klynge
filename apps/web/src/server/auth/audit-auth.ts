import { SupabaseAccountStore } from "../account/supabase-account-store.ts";
import { audit } from "../notifications/dispatcher.ts";
import { processDeps, storeMode } from "../runtime.ts";
import { SupabaseAuthGateway } from "./supabase-auth.ts";
import type { AuthGateway, VerifiedUser } from "./types.ts";

/** Audit sign-in/out into the verified user's own account log (user-bound in Supabase mode). Best-effort. */
export async function auditAuth(gateway: AuthGateway, user: VerifiedUser, action: "auth.sign_in" | "auth.sign_out", detail: string): Promise<void> {
  try {
    const account = storeMode() === "supabase" ? (gateway instanceof SupabaseAuthGateway ? new SupabaseAccountStore(gateway.client, user.id) : null) : processDeps().account;
    if (account) await audit(account, user.id, Date.now(), action, detail);
  } catch {
    // auditing never blocks authentication
  }
}
