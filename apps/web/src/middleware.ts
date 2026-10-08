import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { csrfVerdict } from "./server/csrf.ts";

const TRIAL_COOKIE = "klynge_trial";
const SESSION_COOKIE = "klynge_session";
const LEGACY_TENANT_COOKIE = "klynge_tenant";

/**
 * 1. Anonymous trial + workspace session cookies (random, httpOnly). A trial cookie only keys short-lived in-memory
 *    trial state — it is NEVER a durable tenant identity (that is always the verified auth user id).
 * 2. Supabase session refresh (rotates the auth cookies). Identity is verified again on the server per request.
 */
export async function middleware(req: NextRequest) {
  // 0. CSRF: state-changing requests must originate from this site.
  const csrf = csrfVerdict(req.method, req.nextUrl, req.headers, process.env.KLYNGE_SITE_URL);
  if (!csrf.ok) return NextResponse.json({ error: "Request blocked" }, { status: 403 });
  const opts = { httpOnly: true, sameSite: "lax" as const, secure: req.nextUrl.protocol === "https:", path: "/" };
  const issued: [string, string, number][] = [];
  if (!req.cookies.get(TRIAL_COOKIE)) issued.push([TRIAL_COOKIE, crypto.randomUUID(), 60 * 60 * 24 * 30]);
  if (!req.cookies.get(SESSION_COOKIE)) issued.push([SESSION_COOKIE, crypto.randomUUID(), 60 * 60 * 24]);
  for (const [name, value] of issued) req.cookies.set(name, value);

  let res = NextResponse.next({ request: req });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && anon && process.env.KLYNGE_AUTH !== "mock" && process.env.KLYNGE_AUTH !== "disabled") {
    const supabase = createServerClient(url, anon, {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (list) => {
          for (const c of list) req.cookies.set(c.name, c.value);
          res = NextResponse.next({ request: req });
          for (const c of list) res.cookies.set(c.name, c.value, c.options);
        },
      },
    });
    await supabase.auth.getUser();
  }
  for (const [name, value, maxAge] of issued) res.cookies.set(name, value, { ...opts, maxAge });
  if (req.cookies.get(LEGACY_TENANT_COOKIE)) res.cookies.delete(LEGACY_TENANT_COOKIE);
  return res;
}

export const config = { matcher: ["/app/:path*", "/api/:path*", "/auth/:path*", "/sign-in", "/pilot"] };
