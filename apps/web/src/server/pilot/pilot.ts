import { createHash } from "node:crypto";
import { audit } from "../notifications/dispatcher.ts";
import { track } from "../telemetry.ts";
import { WorkspaceError } from "../workspace.ts";
import type { WorkspaceDeps } from "../workspace.ts";
import { CONSENT_VERSION, PROBLEM_CATEGORIES, RISK_ACK_VERSION, pilotStateOf } from "./types.ts";
import type { FeedbackEntry, OnboardingProgress, PilotEnrollment, PilotState, ProblemCategory, Rating } from "./types.ts";

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);

function pilotOf(deps: WorkspaceDeps) {
  if (!deps.pilot) throw new WorkspaceError("AUTH_REQUIRED", "Sign in with your invited address to join the pilot.");
  return deps.pilot;
}

export async function pilotState(deps: WorkspaceDeps, tenantId: string, email: string | null): Promise<PilotState> {
  const p = pilotOf(deps);
  return pilotStateOf(email ? await p.getInvite(email) : null, await p.getEnrollment(tenantId));
}

/**
 * Batch 71: a verified user activates their OWN pending invite. Requires an explicit financial-risk acknowledgement
 * and pilot consent (versioned). Suspended or completed users cannot re-activate themselves.
 */
export async function activatePilot(deps: WorkspaceDeps, input: { tenantId: string; email: string | null; riskAcknowledged: unknown; consent: unknown; now: number }): Promise<PilotEnrollment> {
  const p = pilotOf(deps);
  if (input.riskAcknowledged !== true || input.consent !== true) throw new WorkspaceError("INVALID", "Please confirm the risk acknowledgement and the pilot consent.");
  const invite = input.email ? await p.getInvite(input.email) : null;
  const existing = await p.getEnrollment(input.tenantId);
  const state = pilotStateOf(invite, existing);
  if (state === "ACTIVE" && existing) return existing;
  if (state !== "INVITED" || !invite) throw new WorkspaceError("NOT_FOUND", state === "NOT_INVITED" ? "No pilot invitation exists for your verified address." : "Your pilot access is not available. Contact the Klynge pilot team.");
  const e: PilotEnrollment = { tenantId: input.tenantId, status: "ACTIVE", cohort: invite.cohort, activatedAt: input.now, riskAckVersion: RISK_ACK_VERSION, consentVersion: CONSENT_VERSION, statusChangedAt: input.now, statusReason: null };
  await p.activate(e);
  if (deps.account) await audit(deps.account, input.tenantId, input.now, "pilot.activated", invite.cohort);
  track(deps.telemetry, "pilot.activated", input.tenantId, input.now, { cohort: invite.cohort });
  return (await p.getEnrollment(input.tenantId)) ?? e;
}

// ── Batch 72: guided onboarding (derived from the user's own state; nothing sensitive is stored) ──────────────────

export type OnboardingStepId = "evidence-modes" | "chart-set" | "corrections" | "verified-data" | "workspace-tools";
export interface OnboardingStep {
  id: OnboardingStepId;
  title: string;
  detail: string;
  done: boolean;
}
export interface OnboardingView {
  steps: OnboardingStep[];
  completed: number;
  complete: boolean;
  dismissed: boolean;
}

const EMPTY: OnboardingProgress = { version: 1, evidenceModesAcknowledgedAt: null, dismissedAt: null };

export async function onboarding(deps: WorkspaceDeps, tenantId: string, sessionId: string): Promise<OnboardingView> {
  const p = pilotOf(deps);
  const progress = (await p.getOnboarding(tenantId)) ?? EMPTY;
  const session = await deps.store.getSession(tenantId, sessionId);
  const records = await deps.store.listRecords(tenantId);
  const roles = new Set((session?.charts ?? []).map((c) => c.role));
  const journal = await deps.store.listJournal(tenantId);
  const prefs = deps.account ? ((await deps.account.getNotificationPrefs(tenantId)) ?? (await deps.account.getPolicy(tenantId))) : null;
  const steps: OnboardingStep[] = [
    { id: "evidence-modes", title: "Understand evidence modes", detail: "Chart screenshots are VISUAL evidence: Klynge reads them as observations and can only show context, WAIT or BLOCKED. Directional setups need DATA mode, built from verified market data.", done: progress.evidenceModesAcknowledgedAt !== null },
    { id: "chart-set", title: "Add the full chart set", detail: "Upload your ticker plus SPX (broad market) and MNQ (technology confirmation). Missing context is listed instead of guessed.", done: (roles.has("TARGET") && roles.has("SPX") && roles.has("MNQ")) || records.some((r) => r.evidenceMode === "VISUAL") },
    { id: "corrections", title: "Review what Klynge read", detail: "Each field shows its provenance and confidence. Confirm or correct it — corrections stay visual evidence and never become verified data.", done: (session?.charts ?? []).some((c) => c.audit.length > 0) },
    { id: "verified-data", title: "Connect verified data", detail: "Connect a licensed data source to evaluate the same ticker deterministically. Stale or missing data produces WAIT or BLOCKED.", done: records.some((r) => r.evidenceMode === "DATA") },
    { id: "workspace-tools", title: "Use journal, alerts and preferences", detail: "Add a journal note, review alerts and history, and set preferences that can only narrow what Klynge shows you.", done: journal.length > 0 || prefs !== null },
  ];
  const completed = steps.filter((s) => s.done).length;
  return { steps, completed, complete: completed === steps.length, dismissed: progress.dismissedAt !== null };
}

export async function updateOnboarding(deps: WorkspaceDeps, tenantId: string, action: unknown, now: number): Promise<void> {
  const p = pilotOf(deps);
  if (action !== "acknowledge-evidence-modes" && action !== "dismiss") throw new WorkspaceError("INVALID", "Unknown onboarding action.");
  const cur = (await p.getOnboarding(tenantId)) ?? EMPTY;
  const next: OnboardingProgress = action === "dismiss" ? { ...cur, dismissedAt: cur.dismissedAt ?? now } : { ...cur, evidenceModesAcknowledgedAt: cur.evidenceModesAcknowledgedAt ?? now };
  await p.putOnboarding(tenantId, next);
  track(deps.telemetry, "onboarding.step", tenantId, now, { step: action === "dismiss" ? "dismissed" : "evidence-modes" });
}

// ── Batch 74: structured feedback (USER_REPORTED; never touches decisions) ─────────────────────────────────────

const rating = (v: unknown): Rating | null => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5 ? (v as Rating) : null);
const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = [...v].filter((ch) => ch === "\n" || ch === "\t" || (ch >= " " && ch !== "\u007f")).join("").trim();
  return t ? t.slice(0, max) : null;
};

export async function submitFeedback(deps: WorkspaceDeps, input: { tenantId: string; sessionId: string; body: unknown; now: number }): Promise<FeedbackEntry> {
  const p = pilotOf(deps);
  const rl = deps.limiter.take(`feedback:${input.tenantId}`, input.now);
  if (!rl.allowed) throw new WorkspaceError("RATE_LIMITED", "Too much feedback at once — try again shortly.", rl.retryAfterMs);
  const b = (input.body && typeof input.body === "object" ? input.body : {}) as Record<string, unknown>;
  const r = (b.ratings && typeof b.ratings === "object" ? b.ratings : {}) as Record<string, unknown>;
  const ratings = { clarity: rating(r.clarity), confidence: rating(r.confidence), usability: rating(r.usability), usefulness: rating(r.usefulness) };
  const problemIn = (b.problem && typeof b.problem === "object" ? b.problem : null) as Record<string, unknown> | null;
  const description = problemIn ? text(problemIn.description, 1000) : null;
  const category = problemIn && (PROBLEM_CATEGORIES as readonly unknown[]).includes(problemIn.category) ? (problemIn.category as ProblemCategory) : "OTHER";
  const missingInformation = text(b.missingInformation, 500);
  if (!Object.values(ratings).some((x) => x !== null) && !missingInformation && !description) throw new WorkspaceError("INVALID", "Add a rating, a note on missing information, or a problem description.");
  // Ties to the user's own session/record only; ids that are not theirs are dropped (never an oracle).
  const recordId = typeof b.recordId === "string" && (await deps.store.listRecords(input.tenantId)).some((x) => x.recordId === b.recordId) ? b.recordId : null;
  const f: FeedbackEntry = { feedbackId: `fb-${hash(`${input.tenantId}|${input.now}|${JSON.stringify([ratings, missingInformation, description])}`)}`, tenantId: input.tenantId, sessionId: input.sessionId, recordId, at: input.now, kind: "USER_REPORTED", ratings, missingInformation, problem: description ? { category, description } : null };
  await p.addFeedback(f);
  if (deps.account) await audit(deps.account, input.tenantId, input.now, "feedback.submitted", f.problem ? `problem ${category}` : "ratings");
  track(deps.telemetry, "feedback.submitted", input.tenantId, input.now, { category: f.problem?.category ?? "NONE", rated: Object.values(ratings).filter((x) => x !== null).length, hasProblem: f.problem !== null });
  return f;
}
