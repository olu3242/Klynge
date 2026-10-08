import "server-only";
import path from "node:path";
import { SupabaseAuthGateway } from "./auth/supabase-auth.ts";
import type { AuthGateway } from "./auth/types.ts";
import { selectExtractor } from "./extraction/select.ts";
import type { ChartExtractor } from "./extraction/types.ts";
import type { Identity } from "./identity.ts";
import { marketDataFromEnv, PROVIDER_SCENARIOS, withScenario } from "./market-data.ts";
import type { MarketDataSetup, ProviderScenario } from "./market-data.ts";
import { RateLimiter } from "./rate-limit.ts";
import { FileSessionStore } from "./store/file-store.ts";
import { MemoryImageStore, MemorySessionStore } from "./store/memory-store.ts";
import { SupabaseSessionStore } from "./store/supabase-store.ts";
import { TrialSessionStore } from "./store/trial-store.ts";
import type { ImageRetention, SessionStore } from "./store/types.ts";
import { consoleTelemetrySink } from "./telemetry.ts";
import { FileAccountStore, MemoryAccountStore } from "./account/memory-account-store.ts";
import { SupabaseAccountStore } from "./account/supabase-account-store.ts";
import type { AccountStore } from "./account/types.ts";
import { FilePilotStore, MemoryPilotStore } from "./pilot/memory-pilot-store.ts";
import { SupabasePilotStore } from "./pilot/supabase-pilot-store.ts";
import type { PilotStore } from "./pilot/types.ts";
import { MockEmailProvider, ResendEmailProvider } from "./notifications/email.ts";
import type { EmailProvider } from "./notifications/email.ts";
import type { TelemetrySink } from "./telemetry.ts";
import { isTestMode } from "./test-mode.ts";
import type { WorkspaceDeps } from "./workspace.ts";

export type StoreMode = "memory" | "file" | "supabase";

interface ProcessDeps {
  images: MemoryImageStore;
  extractor: ChartExtractor;
  limiter: RateLimiter;
  telemetry: TelemetrySink;
  trial: TrialSessionStore;
  /** Shared durable store for memory/file modes (null for supabase: per-request user-bound store). */
  durable: SessionStore | null;
  market: MarketDataSetup | null;
  storeMode: StoreMode;
  /** Shared account store for memory/file modes (null for supabase: per-request user-bound store). */
  account: MemoryAccountStore | null;
  /** Shared pilot store for memory/file modes (null for supabase: per-request user-bound store). */
  pilot: MemoryPilotStore | null;
  email: EmailProvider | null;
}

let proc: ProcessDeps | undefined;

export function storeMode(env: Readonly<Record<string, string | undefined>> = process.env): StoreMode {
  return env.KLYNGE_STORE === "supabase" ? "supabase" : env.KLYNGE_STORE === "file" ? "file" : "memory";
}

/** Process-wide dependencies, configured from server-only env. */
export function processDeps(): ProcessDeps {
  if (proc) return proc;
  const env = process.env;
  const retention: ImageRetention = env.KLYNGE_IMAGE_RETENTION === "NONE" ? "NONE" : "SESSION";
  const mode = storeMode(env);
  proc = {
    images: new MemoryImageStore(retention),
    extractor: selectExtractor(env),
    limiter: new RateLimiter(),
    telemetry: consoleTelemetrySink,
    trial: new TrialSessionStore(),
    durable: mode === "memory" ? new MemorySessionStore() : mode === "file" ? new FileSessionStore(path.resolve(env.KLYNGE_STORE_FILE ?? ".klynge/store.json")) : null,
    market: marketDataFromEnv(env),
    storeMode: mode,
    account: mode === "memory" ? new MemoryAccountStore() : mode === "file" ? new FileAccountStore(path.resolve(env.KLYNGE_ACCOUNT_STORE_FILE ?? ".klynge/account.json")) : null,
    pilot: mode === "memory" ? new MemoryPilotStore() : mode === "file" ? new FilePilotStore(path.resolve(env.KLYNGE_PILOT_STORE_FILE ?? ".klynge/pilot.json")) : null,
    email: emailFromEnv(env),
  };
  return proc;
}

/** KLYNGE_EMAIL=resend (RESEND_API_KEY + KLYNGE_EMAIL_FROM, server-only) | mock (test mode) | none (default). */
export function emailFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): EmailProvider | null {
  if (env.KLYNGE_EMAIL === "resend") return new ResendEmailProvider({ apiKey: env.RESEND_API_KEY ?? "", from: env.KLYNGE_EMAIL_FROM ?? "" });
  if (env.KLYNGE_EMAIL === "mock") {
    if (!isTestMode(env)) throw new Error("KLYNGE_EMAIL=mock requires test mode");
    return new MockEmailProvider();
  }
  return null;
}

/**
 * Dependencies for ONE request, chosen by the server-verified identity:
 *  TRIAL → in-memory trial store (no durable ownership);
 *  USER  → durable store owned by the auth user id (Supabase: user-bound client, RLS enforced).
 */
export function depsFor(identity: Identity, gateway: AuthGateway, headers?: Headers): WorkspaceDeps {
  const p = processDeps();
  let store: SessionStore;
  if (identity.kind === "TRIAL") store = p.trial;
  else if (p.storeMode === "supabase") {
    if (!(gateway instanceof SupabaseAuthGateway)) throw new Error("KLYNGE_STORE=supabase requires Supabase Auth");
    store = new SupabaseSessionStore(gateway.client, identity.user.id);
  } else store = p.durable as SessionStore;
  const scenario = headers ? scenarioFrom(headers) : null;
  const market = p.market && scenario ? withScenario(p.market, scenario) : p.market;
  let account: AccountStore | null = null;
  if (identity.kind === "USER") account = p.storeMode === "supabase" ? new SupabaseAccountStore((gateway as SupabaseAuthGateway).client, identity.user.id) : p.account;
  let pilot: PilotStore | null = null;
  if (identity.kind === "USER") pilot = p.storeMode === "supabase" ? new SupabasePilotStore((gateway as SupabaseAuthGateway).client, identity.user.id) : p.pilot;
  return { store, images: p.images, extractor: p.extractor, limiter: p.limiter, telemetry: p.telemetry, market, account, pilot, email: identity.kind === "USER" ? p.email : null };
}

/** Evaluation clock. A header override exists ONLY in test mode (e2e); production always uses wall time. */
export function clockFrom(headers: Headers): number {
  if (isTestMode()) {
    const v = Number(headers.get("x-klynge-now"));
    if (Number.isSafeInteger(v) && v > 0) return v;
  }
  return Date.now();
}

/** Test-mode provider failure injection. Ignored outside test mode. */
export function scenarioFrom(headers: Headers): ProviderScenario | null {
  if (!isTestMode()) return null;
  const v = headers.get("x-klynge-provider-scenario");
  return v && (PROVIDER_SCENARIOS as readonly string[]).includes(v) ? (v as ProviderScenario) : null;
}
