import { NextResponse } from "next/server";
import { nextCookieJar } from "@/server/http";
import { gatewayFor } from "@/server/auth/select";
import { safeNext, siteOrigin } from "@/server/auth/redirect";
import { processDeps } from "@/server/runtime";
import { track } from "@/server/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Email magic-link callback: verify the token hash and start a session. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get("next"));
  const origin = siteOrigin(req);
  try {
    const user = await gatewayFor(await nextCookieJar()).verifyMagicLink(url.searchParams.get("token_hash") ?? "", url.searchParams.get("type") ?? "");
    track(processDeps().telemetry, "auth.sign_in", user.id, Date.now(), { method: "email", outcome: "ok" });
    return NextResponse.redirect(new URL(next, origin), 303);
  } catch {
    return NextResponse.redirect(new URL(`/sign-in?error=link&next=${encodeURIComponent(next)}`, origin), 303);
  }
}
