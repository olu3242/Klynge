import { NextResponse } from "next/server";
import { errorResponse, requestContext, SESSION_COOKIE, withAccount } from "@/server/http";
import { PROMO_DISMISSED_COOKIE } from "@/server/identity";
import { clockFrom, processDeps } from "@/server/runtime";
import { promoteTrial, WorkspaceError } from "@/server/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "Save this analysis to your account?" — copies the trial only after explicit acceptance. */
export async function POST(req: Request) {
  try {
    const { identity, deps, jar, account } = await requestContext();
    if (identity.kind !== "USER") throw new WorkspaceError("AUTH_REQUIRED", "Sign in to save an analysis.");
    const body = (await req.json().catch(() => ({}))) as { accept?: unknown };
    if (body.accept !== true) {
      jar.set(PROMO_DISMISSED_COOKIE, identity.sessionId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 });
      return NextResponse.json({ ok: true, promoted: false });
    }
    if (!identity.trialTenantId) throw new WorkspaceError("NOT_FOUND", "No trial analysis to save");
    const newSessionId = crypto.randomUUID();
    const view = await promoteTrial(processDeps().trial, deps, { trialTenantId: identity.trialTenantId, trialSessionId: identity.sessionId, userId: identity.user.id, newSessionId, now: clockFrom(req.headers) });
    jar.set(SESSION_COOKIE, newSessionId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 });
    return NextResponse.json(withAccount(view, { ...account, promotionAvailable: false }));
  } catch (e) {
    return errorResponse(e);
  }
}
