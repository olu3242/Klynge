import { NextResponse } from "next/server";
import { nextCookieJar } from "@/server/http";
import { gatewayFor } from "@/server/auth/select";
import { safeNext, siteOrigin } from "@/server/auth/redirect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const next = safeNext(String(form?.get("next") ?? ""));
  const origin = siteOrigin(req);
  try {
    const { url } = await gatewayFor(await nextCookieJar()).startOAuth("google", `${origin}/auth/callback?next=${encodeURIComponent(next)}`);
    return NextResponse.redirect(new URL(url, origin), 303);
  } catch {
    return NextResponse.redirect(new URL(`/sign-in?error=oauth&next=${encodeURIComponent(next)}`, origin), 303);
  }
}
