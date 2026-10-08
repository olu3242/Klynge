import { NextResponse } from "next/server";
import { nextCookieJar } from "@/server/http";
import { MockAuthGateway } from "@/server/auth/mock-auth";
import { authMode } from "@/server/auth/select";
import { siteOrigin } from "@/server/auth/redirect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** TEST MODE ONLY: the mock "Google" consent approves and redirects back with a signed one-time code. */
export async function POST(req: Request) {
  if (authMode() !== "mock") return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const redirectTo = String(form.get("redirect_to") ?? "");
  const email = String(form.get("email") ?? "").trim();
  const origin = siteOrigin(req);
  const target = new URL(redirectTo, origin);
  if (target.origin !== origin || target.pathname !== "/auth/callback") return new NextResponse(null, { status: 400 });
  try {
    target.searchParams.set("code", new MockAuthGateway(await nextCookieJar()).issueOAuthCode(email));
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  return NextResponse.redirect(target, 303);
}
