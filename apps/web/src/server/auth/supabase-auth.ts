import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthGateway, CookieJar, VerifiedUser } from "./types.ts";
import { AuthError, EMAIL_PATTERN } from "./types.ts";

/**
 * Supabase Auth (Google OAuth + email magic link, PKCE). Uses the PUBLIC anon key only; the user's session lives in
 * httpOnly cookies managed by @supabase/ssr. The same client is user-bound, so database calls made with it run
 * under the user's JWT and RLS applies. The service-role key is never used here.
 */
export class SupabaseAuthGateway implements AuthGateway {
  readonly kind = "supabase" as const;
  readonly client: SupabaseClient;
  constructor(jar: CookieJar, env: Readonly<Record<string, string | undefined>> = process.env) {
    const url = env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) throw new AuthError("NOT_CONFIGURED", "Supabase Auth is not configured");
    this.client = createServerClient(url, anon, {
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (list) => {
          for (const c of list) {
            try {
              jar.set(c.name, c.value, c.options as never);
            } catch {
              // Server Components cannot set cookies; middleware refreshes the session instead.
            }
          }
        },
      },
    });
  }

  private static toUser(u: { id: string; email?: string | null; app_metadata?: { provider?: string; klynge_role?: unknown } } | null | undefined): VerifiedUser | null {
    if (!u?.id) return null;
    const p = u.app_metadata?.provider;
    const role = u.app_metadata?.klynge_role;
    return { id: u.id, email: u.email ?? null, method: p === "google" ? "google" : p === "email" ? "email" : "unknown", ...(typeof role === "string" ? { appRole: role } : {}) };
  }

  /** Verified against Supabase Auth (getUser revalidates the JWT server-side; never trusts the cookie payload alone). */
  async getUser(): Promise<VerifiedUser | null> {
    const { data, error } = await this.client.auth.getUser();
    return error ? null : SupabaseAuthGateway.toUser(data.user);
  }
  async startOAuth(provider: "google", redirectTo: string) {
    const { data, error } = await this.client.auth.signInWithOAuth({ provider, options: { redirectTo, skipBrowserRedirect: true } });
    if (error || !data.url) throw new AuthError("PROVIDER_ERROR", "Could not start Google sign-in");
    return { url: data.url };
  }
  async sendMagicLink(email: string, redirectTo: string) {
    if (!EMAIL_PATTERN.test(email)) throw new AuthError("INVALID_EMAIL", "Enter a valid email address");
    const { error } = await this.client.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: true } });
    if (error) throw new AuthError("PROVIDER_ERROR", "Could not send the sign-in link");
  }
  async exchangeCode(code: string) {
    const { data, error } = await this.client.auth.exchangeCodeForSession(code);
    const user = SupabaseAuthGateway.toUser(data?.user);
    if (error || !user) throw new AuthError("INVALID_CODE", "Sign-in link expired or invalid");
    return user;
  }
  async verifyMagicLink(tokenHash: string, type: string) {
    if (type !== "magiclink" && type !== "email") throw new AuthError("INVALID_LINK", "Sign-in link expired or invalid");
    const { data, error } = await this.client.auth.verifyOtp({ token_hash: tokenHash, type });
    const user = SupabaseAuthGateway.toUser(data?.user);
    if (error || !user) throw new AuthError("INVALID_LINK", "Sign-in link expired or invalid");
    return user;
  }
  /** Global sign-out: Supabase revokes every refresh token for the user server-side. */
  async signOut() {
    await this.client.auth.signOut({ scope: "global" });
  }
}

/** Auth not configured: anonymous trial only. */
export const disabledGateway: AuthGateway = {
  kind: "disabled",
  getUser: async () => null,
  startOAuth: async () => {
    throw new AuthError("NOT_CONFIGURED", "Sign-in is not configured");
  },
  sendMagicLink: async () => {
    throw new AuthError("NOT_CONFIGURED", "Sign-in is not configured");
  },
  exchangeCode: async () => {
    throw new AuthError("NOT_CONFIGURED", "Sign-in is not configured");
  },
  verifyMagicLink: async () => {
    throw new AuthError("NOT_CONFIGURED", "Sign-in is not configured");
  },
  signOut: async () => undefined,
};
