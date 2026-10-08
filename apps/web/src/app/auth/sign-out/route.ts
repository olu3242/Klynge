import { NextResponse } from "next/server";
import { nextCookieJar, SESSION_COOKIE } from "@/server/http";
import { gatewayFor } from "@/server/auth/select";
import { siteOrigin } from "@/server/auth/redirect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const jar = await nextCookieJar();
  await gatewayFor(jar).signOut().catch(() => undefined);
  // Fresh workspace session: nothing from the signed-in session is visible to the next (anonymous) visitor.
  jar.set(SESSION_COOKIE, crypto.randomUUID(), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 });
  return NextResponse.redirect(new URL("/app", siteOrigin(req)), 303);
}
