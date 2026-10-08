import { isTestMode } from "../test-mode.ts";
import { MockAuthGateway } from "./mock-auth.ts";
import { disabledGateway, SupabaseAuthGateway } from "./supabase-auth.ts";
import type { AuthGateway, CookieJar } from "./types.ts";

export type AuthMode = "supabase" | "mock" | "disabled";

/** KLYNGE_AUTH=supabase|mock. Mock requires test mode; default is supabase when configured, else disabled (trial only). */
export function authMode(env: Readonly<Record<string, string | undefined>> = process.env): AuthMode {
  if (env.KLYNGE_AUTH === "mock") {
    if (!isTestMode(env)) throw new Error("KLYNGE_AUTH=mock requires KLYNGE_TEST_MODE=1 (never in production)");
    return "mock";
  }
  if (env.KLYNGE_AUTH === "disabled") return "disabled";
  return env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? "supabase" : "disabled";
}

export function gatewayFor(jar: CookieJar, env: Readonly<Record<string, string | undefined>> = process.env, opts: { secure?: boolean } = {}): AuthGateway {
  const mode = authMode(env);
  if (mode === "mock") return new MockAuthGateway(jar, { env, ...(opts.secure !== undefined ? { secure: opts.secure } : {}) });
  if (mode === "supabase") return new SupabaseAuthGateway(jar, env);
  return disabledGateway;
}
