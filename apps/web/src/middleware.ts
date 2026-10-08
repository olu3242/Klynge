import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Pseudonymous tenant + workspace session cookies (httpOnly). Real authentication is a later batch;
 * until then the tenant id scopes storage, rate limits and telemetry hashing.
 */
export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const opts = { httpOnly: true, sameSite: "lax" as const, secure: req.nextUrl.protocol === "https:", path: "/" };
  if (!req.cookies.get("klynge_tenant")) res.cookies.set("klynge_tenant", crypto.randomUUID(), { ...opts, maxAge: 60 * 60 * 24 * 365 });
  if (!req.cookies.get("klynge_session")) res.cookies.set("klynge_session", crypto.randomUUID(), { ...opts, maxAge: 60 * 60 * 24 });
  return res;
}

export const config = { matcher: ["/app/:path*", "/api/:path*"] };
