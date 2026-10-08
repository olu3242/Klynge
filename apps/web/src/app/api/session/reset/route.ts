import { NextResponse } from "next/server";
import { errorResponse, identity, SESSION_COOKIE } from "@/server/http";
import { runtimeDeps } from "@/server/runtime";
import { resetSession } from "@/server/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ends the workspace session: purges session images and starts a fresh session id. */
export async function POST() {
  try {
    const { tenantId, sessionId } = await identity();
    await resetSession(runtimeDeps(), tenantId, sessionId);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, crypto.randomUUID(), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 });
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
