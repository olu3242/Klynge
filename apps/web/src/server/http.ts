import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { gatewayFor } from "./auth/select.ts";
import type { AuthGateway, CookieJar, CookieOptions } from "./auth/types.ts";
import { AuthError } from "./auth/types.ts";
import { IdentityError, PROMO_DISMISSED_COOKIE, resolveIdentity } from "./identity.ts";
import type { Identity } from "./identity.ts";
import { IntakeError } from "./intake.ts";
import { isOperator } from "./ops/operator.ts";
import { accessMode, pilotGateVerdict } from "./pilot/access.ts";
import type { AccessMode } from "./pilot/access.ts";
import { pilotStateOf } from "./pilot/types.ts";
import type { PilotState } from "./pilot/types.ts";
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
  /** Pilot access (Batch 71): mode, the verified user's state (null for anonymous) and operator status. */
  pilot: { mode: AccessMode; state: PilotState | null; operator: boolean };
}

/** Raised when invite-only access denies a request. Never discloses anything beyond the caller's own state. */
export class PilotAccessError extends Error {
  override readonly name = "PilotAccessError";
  readonly state: PilotState | "SIGN_IN_REQUIRED";
  constructor(state: PilotState | "SIGN_IN_REQUIRED") {
    super(state === "SIGN_IN_REQUIRED" ? "Klynge is in a private pilot. Sign in with your invited address." : `Pilot access unavailable (${state.toLowerCase().replace("_", " ")}).`);
    this.state = state;
  }
}

/**
 * Server-derived identity + per-request deps. Nothing from the request body/query decides ownership.
 * Invite-only access (pilot): anonymous callers must sign in; verified users must hold an ACTIVE enrollment; operators
 * pass. `pilotGate: false` is reserved for the enrollment flow and privacy rights (export/deletion).
 */
export async function requestContext(opts: { pilotGate?: boolean } = {}): Promise<RequestContext> {
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
  const mode = accessMode(process.env, h);
  const operator = isOperator(identity, gateway.kind);
  let state: PilotState | null = null;
  if (identity.kind === "USER" && deps.pilot) state = pilotStateOf(identity.user.email ? await deps.pilot.getInvite(identity.user.email) : null, await deps.pilot.getEnrollment(identity.tenantId));
  const denied = opts.pilotGate === false ? null : pilotGateVerdict(mode, identity.kind, state, operator);
  if (denied) throw new PilotAccessError(denied);
  return {
    jar,
    gateway,
    identity,
    deps,
    pilot: { mode, state, operator },
    account: { email: identity.kind === "USER" ? identity.user.email : null, authEnabled: gateway.kind !== "disabled", promotionAvailable },
  };
}

/** Pages: invite-only denials redirect to sign-in or the pilot page instead of erroring. */
export async function pageContext(next: string, opts: { pilotGate?: boolean } = {}): Promise<RequestContext> {
  try {
    return await requestContext(opts);
  } catch (e) {
    if (e instanceof PilotAccessError) redirect(e.state === "SIGN_IN_REQUIRED" ? `/sign-in?next=${encodeURIComponent(next)}` : "/pilot");
    throw e;
  }
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
  if (e instanceof PilotAccessError) return NextResponse.json({ error: e.message, code: "PILOT_ACCESS", pilotState: e.state }, { status: e.state === "SIGN_IN_REQUIRED" ? 401 : 403 });
  if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.code === "NOT_CONFIGURED" ? 503 : 400 });
  console.error(`[api] ${(e as Error)?.name ?? "Error"}`);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}
