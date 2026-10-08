import { NextResponse } from "next/server";
import { nextCookieJar } from "@/server/http";
import { gatewayFor } from "@/server/auth/select";
import { safeNext, siteOrigin } from "@/server/auth/redirect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const email = String(form?.get("email") ?? "").trim();
  const next = safeNext(String(form?.get("next") ?? ""));
  const origin = siteOrigin(req);
  try {
    await gatewayFor(await nextCookieJar()).sendMagicLink(email, `${origin}/auth/confirm?next=${encodeURIComponent(next)}`);
    return NextResponse.redirect(new URL(`/sign-in?sent=1&next=${encodeURIComponent(next)}`, origin), 303);
  } catch {
    return NextResponse.redirect(new URL(`/sign-in?error=email&next=${encodeURIComponent(next)}`, origin), 303);
  }
}
