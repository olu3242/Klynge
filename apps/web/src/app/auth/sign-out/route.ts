import { NextResponse } from "next/server";
import { nextCookieJar, SESSION_COOKIE } from "@/server/http";
import { gatewayFor } from "@/server/auth/select";
import { siteOrigin } from "@/server/auth/redirect";
import { auditAuth } from "@/server/auth/audit-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const jar = await nextCookieJar();
  const gateway = gatewayFor(jar);
  const user = await gateway.getUser().catch(() => null);
  if (user) await auditAuth(gateway, user, "auth.sign_out", "signed out");
  await gateway.signOut().catch(() => undefined);
  // Fresh workspace session: nothing from the signed-in session is visible to the next (anonymous) visitor.
  jar.set(SESSION_COOKIE, crypto.randomUUID(), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 });
  return NextResponse.redirect(new URL("/app", siteOrigin(req)), 303);
}
