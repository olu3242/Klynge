/** Server-side auth contracts. The browser never sees tokens; identity is derived on the server only. */
export type AuthMethod = "google" | "email";

export interface VerifiedUser {
  /** Canonical identity: the auth user id (UUID). This IS the tenant owner id. */
  id: string;
  email: string | null;
  method: AuthMethod | "unknown";
  /** Supabase app_metadata.klynge_role (writable only with the service role, never by the user). */
  appRole?: string | null;
}

export interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
  path?: string;
  maxAge?: number;
  expires?: Date;
  domain?: string;
}

/** Minimal cookie store (next/headers cookies() in routes; a Map in tests). */
export interface CookieJar {
  get(name: string): string | undefined;
  getAll(): { name: string; value: string }[];
  set(name: string, value: string, options?: CookieOptions): void;
  delete(name: string): void;
}

export class AuthError extends Error {
  override readonly name = "AuthError";
  readonly code: "INVALID_LINK" | "INVALID_CODE" | "PROVIDER_ERROR" | "NOT_CONFIGURED" | "INVALID_EMAIL";
  constructor(code: AuthError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Auth boundary. Implementations: Supabase Auth (production) and a signed mock (test mode only).
 * `getUser` must VERIFY the session (Supabase: Auth server; mock: HMAC + expiry) — never trust a cookie value as an id.
 */
export interface AuthGateway {
  readonly kind: "supabase" | "mock" | "disabled";
  getUser(): Promise<VerifiedUser | null>;
  startOAuth(provider: "google", redirectTo: string): Promise<{ url: string }>;
  sendMagicLink(email: string, redirectTo: string): Promise<void>;
  exchangeCode(code: string): Promise<VerifiedUser>;
  verifyMagicLink(tokenHash: string, type: string): Promise<VerifiedUser>;
  signOut(): Promise<void>;
}

export const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
