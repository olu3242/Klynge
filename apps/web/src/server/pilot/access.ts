import { isTestMode } from "../test-mode.ts";
import type { PilotState } from "./types.ts";

export type AccessMode = "invite-only" | "open";

/**
 * Public access stays restricted until release authorization. Production deployments are invite-only unless the
 * server-only KLYNGE_RELEASE_AUTHORIZED=general-availability is set (a deliberate, approved release step). Elsewhere
 * KLYNGE_ACCESS chooses (default open for local development). Test mode may force a mode per request (e2e only).
 */
export function accessMode(env: Readonly<Record<string, string | undefined>> = process.env, headers?: Headers): AccessMode {
  if (headers && isTestMode(env)) {
    const forced = headers.get("x-klynge-access");
    if (forced === "invite-only" || forced === "open") return forced;
  }
  const production = env.VERCEL_ENV === "production" || env.KLYNGE_DEPLOYMENT === "production";
  if (production) return env.KLYNGE_RELEASE_AUTHORIZED === "general-availability" && env.KLYNGE_ACCESS === "open" ? "open" : "invite-only";
  return env.KLYNGE_ACCESS === "invite-only" ? "invite-only" : "open";
}

/** The gate decision itself (pure): null = allowed, otherwise the reason shown to the caller. */
export function pilotGateVerdict(mode: AccessMode, identityKind: "USER" | "TRIAL", state: PilotState | null, operator: boolean): PilotState | "SIGN_IN_REQUIRED" | null {
  if (mode === "open" || operator) return null;
  if (identityKind !== "USER") return "SIGN_IN_REQUIRED";
  return state === "ACTIVE" ? null : (state ?? "NOT_INVITED");
}
