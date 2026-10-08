import type { AuthGateway, CookieJar, VerifiedUser } from "./auth/types.ts";

export const TRIAL_COOKIE = "klynge_trial";
export const SESSION_COOKIE = "klynge_session";
export const PROMO_DISMISSED_COOKIE = "klynge_promo_dismissed";
/** Legacy pseudonymous tenant cookie (≤ 0.4.0). Ignored and cleared — no cookie may act as a durable tenant. */
export const LEGACY_TENANT_COOKIE = "klynge_tenant";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string | undefined): v is string => typeof v === "string" && UUID.test(v);

/**
 * Who is calling, derived ONLY on the server:
 *  USER  — verified by the auth gateway; tenantId = auth user id (durable ownership).
 *  TRIAL — anonymous; tenantId = "trial:<random cookie>" used only to key the in-memory trial store.
 * Request bodies, query parameters and client-selected ids never influence ownership.
 */
export type Identity =
  | { kind: "USER"; user: VerifiedUser; tenantId: string; sessionId: string; trialTenantId: string | null }
  | { kind: "TRIAL"; tenantId: string; sessionId: string };

export class IdentityError extends Error {
  override readonly name = "IdentityError";
}

export async function resolveIdentity(gateway: AuthGateway, jar: CookieJar): Promise<Identity> {
  const sessionId = jar.get(SESSION_COOKIE);
  if (!isUuid(sessionId)) throw new IdentityError("No workspace session");
  const trial = jar.get(TRIAL_COOKIE);
  const trialTenantId = isUuid(trial) ? `trial:${trial}` : null;
  const user = await gateway.getUser();
  if (user) {
    if (!isUuid(user.id)) throw new IdentityError("Auth returned a malformed user id");
    return { kind: "USER", user, tenantId: user.id, sessionId, trialTenantId };
  }
  if (!trialTenantId) throw new IdentityError("No trial session");
  return { kind: "TRIAL", tenantId: trialTenantId, sessionId };
}
