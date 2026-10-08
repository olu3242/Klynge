/** Post-auth redirect target: same-origin relative paths only (no open redirects). */
export function safeNext(next: string | null | undefined, fallback = "/app"): string {
  if (!next || typeof next !== "string") return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || /[\r\n]/.test(next)) return fallback;
  try {
    const u = new URL(next, "http://klynge.invalid");
    return u.origin === "http://klynge.invalid" ? `${u.pathname}${u.search}` : fallback;
  } catch {
    return fallback;
  }
}

/** Public origin for auth redirects (configure KLYNGE_SITE_URL behind proxies; must be in Supabase's redirect allow-list). */
export function siteOrigin(req: Request, env: Readonly<Record<string, string | undefined>> = process.env): string {
  const configured = env.KLYNGE_SITE_URL;
  if (configured) return new URL(configured).origin;
  // The host the browser actually used (cookies are host-scoped). Production should set KLYNGE_SITE_URL.
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? url.protocol.replace(":", "");
  if (host && /^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host) && (proto === "http" || proto === "https")) return `${proto}://${host}`;
  return url.origin;
}
