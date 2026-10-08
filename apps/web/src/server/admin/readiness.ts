/**
 * Hosted environment validation. Reports presence/shape only — never values, lengths of secrets or prefixes.
 */
export type CheckStatus = "PASS" | "FAIL" | "WARN";

export interface ReadinessCheck {
  id: string;
  status: CheckStatus;
  detail: string;
}

const present = (v: string | undefined) => typeof v === "string" && v.trim().length > 0;
const looksLikeKey = (v: string | undefined) => present(v) && (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(v as string) || /^sb_(publishable|secret)_[A-Za-z0-9_-]{10,}$/.test(v as string));

export function validateHostedEnv(env: Readonly<Record<string, string | undefined>>, expectedProjectRef?: string): ReadinessCheck[] {
  const out: ReadinessCheck[] = [];
  const add = (id: string, ok: boolean, detail: string, warn = false) => out.push({ id, status: ok ? "PASS" : warn ? "WARN" : "FAIL", detail });
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  let ref: string | null = null;
  try {
    const u = url ? new URL(url) : null;
    ref = u && u.protocol === "https:" && /^[a-z0-9]{20}\.supabase\.co$/.test(u.hostname) ? (u.hostname.split(".")[0] as string) : null;
  } catch {
    ref = null;
  }
  add("supabase.url", ref !== null, ref ? "public Supabase URL is an https project URL" : "NEXT_PUBLIC_SUPABASE_URL missing or not https://<ref>.supabase.co");
  if (expectedProjectRef) add("supabase.project", ref === expectedProjectRef, ref === expectedProjectRef ? "URL targets the expected project" : "URL does not target the expected project");
  add("supabase.server-url", env.SUPABASE_URL === undefined || env.SUPABASE_URL === url, "SUPABASE_URL matches the public URL (or is unset)");
  add("supabase.anon-key", looksLikeKey(env.NEXT_PUBLIC_SUPABASE_ANON_KEY), "public anon/publishable key present and well-formed");
  add("supabase.service-key", looksLikeKey(env.SUPABASE_SERVICE_ROLE_KEY), "service-role key present and well-formed (server-only)");
  add("supabase.keys-distinct", !present(env.SUPABASE_SERVICE_ROLE_KEY) || env.SUPABASE_SERVICE_ROLE_KEY !== env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "service-role key differs from the public key");
  for (const k of Object.keys(env)) {
    if (/^NEXT_PUBLIC_/.test(k) && /(SERVICE|SECRET|PRIVATE|TOKEN|PASSWORD)/.test(k)) add(`public-secret:${k}`, false, `${k} looks like a secret but is exposed to the browser`);
  }
  let site: URL | null = null;
  try {
    site = env.KLYNGE_SITE_URL ? new URL(env.KLYNGE_SITE_URL) : null;
  } catch {
    site = null;
  }
  add("site.url", Boolean(site && site.protocol === "https:"), "KLYNGE_SITE_URL is an https origin (must be in the Supabase redirect allow-list)");
  add("auth.mode", env.KLYNGE_AUTH !== "mock" && env.KLYNGE_AUTH !== "disabled", "Supabase Auth is the active auth mode");
  add("test-mode.off", env.KLYNGE_TEST_MODE !== "1" && env.KLYNGE_E2E_RUN !== "1", "test mode is disabled");
  add("deployment.marked", env.KLYNGE_DEPLOYMENT === "production" || env.VERCEL_ENV === "production", "deployment is marked production (test machinery hard-refused)", true);
  add("store.supabase", env.KLYNGE_STORE === "supabase", "durable store is Supabase (user-bound, RLS)");
  add("email.recipients", env.KLYNGE_EMAIL !== "mock", "mock email is not configured");
  add("pilot.access", env.KLYNGE_ACCESS !== "open" || env.KLYNGE_RELEASE_AUTHORIZED === "general-availability", "public access stays invite-only until general availability is explicitly authorized");
  add("cron.secret", env.KLYNGE_EMAIL !== "resend" || (present(env.KLYNGE_CRON_SECRET) && (env.KLYNGE_CRON_SECRET as string).length >= 32), "notification worker secret configured (≥ 32 chars) when email is on", true);
  return out;
}

export function readinessSummary(checks: readonly ReadinessCheck[]): { ready: boolean; failed: string[]; warnings: string[] } {
  return { ready: checks.every((c) => c.status !== "FAIL"), failed: checks.filter((c) => c.status === "FAIL").map((c) => c.id), warnings: checks.filter((c) => c.status === "WARN").map((c) => c.id) };
}
