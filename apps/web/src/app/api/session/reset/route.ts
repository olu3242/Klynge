import { NextResponse } from "next/server";
import { errorResponse, requestContext, SESSION_COOKIE } from "@/server/http";
import { resetSession } from "@/server/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ends the workspace session: purges session images and starts a fresh session id. */
export async function POST() {
  try {
    const { identity, deps } = await requestContext();
    await resetSession(deps, identity.tenantId, identity.sessionId);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, crypto.randomUUID(), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 });
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
