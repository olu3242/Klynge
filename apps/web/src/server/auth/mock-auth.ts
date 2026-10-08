import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { AuthGateway, CookieJar, VerifiedUser } from "./types.ts";
import { AuthError, EMAIL_PATTERN } from "./types.ts";

/**
 * TEST-MODE ONLY auth that mimics Supabase's flows offline: Google OAuth (code exchange) and email magic links.
 * Every artifact is HMAC-signed and expiring, so identity is still verified, never read from a raw cookie.
 */
export const MOCK_SESSION_COOKIE = "klynge_mock_session";
const SESSION_TTL_S = 60 * 60 * 8;
const CODE_TTL_S = 300;

const outbox = new Map<string, string>();
/** One-time artifacts already redeemed (codes / magic links cannot be replayed). */
const redeemed = new Set<string>();
/** Latest magic link per email (exposed to e2e through a test-only route). */
export const mockOutbox = { latest: (email: string) => outbox.get(email.toLowerCase()) ?? null, clear: () => outbox.clear() };

let processSecret: string | undefined;
function secretFrom(env: Readonly<Record<string, string | undefined>>): string {
  if (env.KLYNGE_TEST_AUTH_SECRET) return env.KLYNGE_TEST_AUTH_SECRET;
  processSecret ??= randomBytes(32).toString("hex");
  return processSecret;
}

/** Deterministic UUID-shaped id per email (stable across restarts, like a real auth user id). */
export function mockUserId(email: string): string {
  const h = createHash("sha256").update(`klynge-mock-user:${email.toLowerCase()}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

interface Claims {
  sub: string;
  email: string;
  method: "google" | "email";
  purpose: "session" | "code" | "magiclink";
  exp: number;
}

export class MockAuthGateway implements AuthGateway {
  readonly kind = "mock" as const;
  private readonly jar: CookieJar;
  private readonly secret: string;
  private readonly clock: () => number;
  private readonly secure: boolean;
  constructor(jar: CookieJar, opts: { env?: Readonly<Record<string, string | undefined>>; clock?: () => number; secure?: boolean } = {}) {
    this.jar = jar;
    this.secret = secretFrom(opts.env ?? process.env);
    this.clock = opts.clock ?? (() => Date.now());
    this.secure = opts.secure ?? false;
  }

  private sign(c: Claims): string {
    const body = Buffer.from(JSON.stringify(c)).toString("base64url");
    return `${body}.${createHmac("sha256", this.secret).update(body).digest("base64url")}`;
  }
  private verify(token: string | undefined, purpose: Claims["purpose"]): Claims | null {
    if (!token) return null;
    const [body, sig] = token.split(".");
    if (!body || !sig) return null;
    const expected = createHmac("sha256", this.secret).update(body).digest();
    const given = Buffer.from(sig, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    try {
      const c = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Claims;
      if (c.purpose !== purpose || c.exp * 1000 <= this.clock() || c.sub !== mockUserId(c.email)) return null;
      return c;
    } catch {
      return null;
    }
  }
  private claims(email: string, method: Claims["method"], purpose: Claims["purpose"], ttl: number): Claims {
    return { sub: mockUserId(email), email: email.toLowerCase(), method, purpose, exp: Math.floor(this.clock() / 1000) + ttl };
  }
  private startSession(c: Claims): VerifiedUser {
    const s = this.sign({ ...c, purpose: "session", exp: Math.floor(this.clock() / 1000) + SESSION_TTL_S });
    this.jar.set(MOCK_SESSION_COOKIE, s, { httpOnly: true, sameSite: "lax", secure: this.secure, path: "/", maxAge: SESSION_TTL_S });
    return { id: c.sub, email: c.email, method: c.method };
  }

  async getUser(): Promise<VerifiedUser | null> {
    const c = this.verify(this.jar.get(MOCK_SESSION_COOKIE), "session");
    return c ? { id: c.sub, email: c.email, method: c.method } : null;
  }
  /** Redirects to the test-only consent screen, which issues a signed one-time code to /auth/callback. */
  async startOAuth(_provider: "google", redirectTo: string): Promise<{ url: string }> {
    return { url: `/auth/mock/google?redirect_to=${encodeURIComponent(redirectTo)}` };
  }
  /** Consent-screen helper: a signed authorization code for `email`. */
  issueOAuthCode(email: string): string {
    if (!EMAIL_PATTERN.test(email)) throw new AuthError("INVALID_EMAIL", "Enter a valid email address");
    return this.sign(this.claims(email, "google", "code", CODE_TTL_S));
  }
  async sendMagicLink(email: string, redirectTo: string): Promise<void> {
    if (!EMAIL_PATTERN.test(email)) throw new AuthError("INVALID_EMAIL", "Enter a valid email address");
    const token = this.sign(this.claims(email, "email", "magiclink", CODE_TTL_S));
    const url = new URL(redirectTo, "http://placeholder.invalid");
    url.searchParams.set("token_hash", token);
    url.searchParams.set("type", "magiclink");
    outbox.set(email.toLowerCase(), url.origin === "http://placeholder.invalid" ? `${url.pathname}${url.search}` : url.toString());
  }
  async exchangeCode(code: string): Promise<VerifiedUser> {
    const c = this.verify(code, "code");
    if (!c || redeemed.has(code)) throw new AuthError("INVALID_CODE", "Sign-in link expired or invalid");
    redeemed.add(code);
    return this.startSession(c);
  }
  async verifyMagicLink(tokenHash: string, type: string): Promise<VerifiedUser> {
    const c = type === "magiclink" || type === "email" ? this.verify(tokenHash, "magiclink") : null;
    if (!c || redeemed.has(tokenHash)) throw new AuthError("INVALID_LINK", "Sign-in link expired or invalid");
    redeemed.add(tokenHash);
    return this.startSession(c);
  }
  async signOut(): Promise<void> {
    this.jar.delete(MOCK_SESSION_COOKIE);
  }
}
