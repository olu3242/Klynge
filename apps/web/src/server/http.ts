import "server-only";
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { gatewayFor } from "./auth/select.ts";
import type { AuthGateway, CookieJar, CookieOptions } from "./auth/types.ts";
import { AuthError } from "./auth/types.ts";
import { IdentityError, PROMO_DISMISSED_COOKIE, resolveIdentity } from "./identity.ts";
import type { Identity } from "./identity.ts";
import { IntakeError } from "./intake.ts";
import { depsFor, processDeps } from "./runtime.ts";
import { WorkspaceError } from "./workspace.ts";
import type { WorkspaceDeps } from "./workspace.ts";
import type { AccountView, WorkspaceView } from "../lib/view-model.ts";

export { SESSION_COOKIE, TRIAL_COOKIE } from "./identity.ts";

/** next/headers cookies() as a CookieJar (set/delete throw in Server Components; callers there only read). */
export async function nextCookieJar(): Promise<CookieJar> {
  const jar = await cookies();
  return {
    get: (name) => jar.get(name)?.value,
    getAll: () => jar.getAll().map((c) => ({ name: c.name, value: c.value })),
    set: (name: string, value: string, options?: CookieOptions) => void jar.set(name, value, options),
    delete: (name) => void jar.delete(name),
  };
}

export interface RequestContext {
  jar: CookieJar;
  gateway: AuthGateway;
  identity: Identity;
  deps: WorkspaceDeps;
  account: Partial<AccountView>;
}

/** Server-derived identity + per-request deps. Nothing from the request body/query decides ownership. */
export async function requestContext(): Promise<RequestContext> {
  const jar = await nextCookieJar();
  const h = await headers();
  const secure = (h.get("x-forwarded-proto") ?? "").includes("https");
  const gateway = gatewayFor(jar, process.env, { secure });
  const identity = await resolveIdentity(gateway, jar);
  const deps = depsFor(identity, gateway, h);
  let promotionAvailable = false;
  if (identity.kind === "USER" && identity.trialTenantId && jar.get(PROMO_DISMISSED_COOKIE) !== identity.sessionId) {
    const trial = await processDeps().trial.getSession(identity.trialTenantId, identity.sessionId);
    promotionAvailable = Boolean(trial && trial.charts.length > 0);
  }
  return {
    jar,
    gateway,
    identity,
    deps,
    account: { email: identity.kind === "USER" ? identity.user.email : null, authEnabled: gateway.kind !== "disabled", promotionAvailable },
  };
}

export const withAccount = (view: WorkspaceView, account: Partial<AccountView>): WorkspaceView => ({ ...view, account: { ...view.account, ...account } });

/** Error mapping that never echoes request bodies, tokens or image data. */
export function errorResponse(e: unknown): NextResponse {
  if (e instanceof WorkspaceError) {
    const status = e.code === "RATE_LIMITED" ? 429 : e.code === "NOT_FOUND" ? 404 : e.code === "AUTH_REQUIRED" ? 401 : 400;
    return NextResponse.json({ error: e.message, code: e.code }, { status, headers: e.retryAfterMs ? { "retry-after": String(Math.ceil(e.retryAfterMs / 1000)) } : {} });
  }
  if (e instanceof IntakeError) return NextResponse.json({ error: e.message }, { status: e.code === "TOO_LARGE" ? 413 : 415 });
  if (e instanceof IdentityError) return NextResponse.json({ error: "No workspace session" }, { status: 401 });
  if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.code === "NOT_CONFIGURED" ? 503 : 400 });
  console.error(`[api] ${(e as Error)?.name ?? "Error"}`);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}
