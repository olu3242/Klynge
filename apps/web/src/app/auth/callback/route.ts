import { NextResponse } from "next/server";
import { nextCookieJar } from "@/server/http";
import { gatewayFor } from "@/server/auth/select";
import { safeNext, siteOrigin } from "@/server/auth/redirect";
import { processDeps } from "@/server/runtime";
import { track } from "@/server/telemetry";
import { auditAuth } from "@/server/auth/audit-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** OAuth (PKCE) callback: exchange the one-time code for a session cookie. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get("next"));
  const origin = siteOrigin(req);
  const code = url.searchParams.get("code");
  try {
    if (!code) throw new Error("missing code");
    const gateway = gatewayFor(await nextCookieJar());
    const user = await gateway.exchangeCode(code);
    await auditAuth(gateway, user, "auth.sign_in", "Google");
    track(processDeps().telemetry, "auth.sign_in", user.id, Date.now(), { method: "google", outcome: "ok" });
    return NextResponse.redirect(new URL(next, origin), 303);
  } catch {
    return NextResponse.redirect(new URL(`/sign-in?error=link&next=${encodeURIComponent(next)}`, origin), 303);
  }
}
