/**
 * CSRF guard (edge-safe, no Node APIs). State-changing requests must come from this site: a browser always sends
 * `Origin` (and `Sec-Fetch-Site`) on cross-site POSTs, so a mismatch is rejected. Requests without either header
 * are non-browser clients, which carry no ambient browser credentials.
 */
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export function expectedOrigin(url: URL, headers: Headers, siteUrl?: string): string {
  if (siteUrl) return new URL(siteUrl).origin;
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  const proto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? url.protocol.replace(":", "");
  return host && /^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host) ? `${proto}://${host}` : url.origin;
}

export function csrfVerdict(method: string, url: URL, headers: Headers, siteUrl?: string): { ok: true } | { ok: false; reason: string } {
  if (SAFE.has(method.toUpperCase())) return { ok: true };
  const origin = headers.get("origin");
  const site = headers.get("sec-fetch-site");
  if (origin && origin !== "null") return origin === expectedOrigin(url, headers, siteUrl) ? { ok: true } : { ok: false, reason: "cross-origin request" };
  if (origin === "null") return { ok: false, reason: "opaque origin" };
  if (site) return site === "same-origin" || site === "none" ? { ok: true } : { ok: false, reason: `cross-site request (${site})` };
  return { ok: true };
}
