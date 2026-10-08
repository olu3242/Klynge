/**
 * Controlled pilot (Batches 71–78). Enrollment is invite-only; a user can only ACTIVATE their own pending invite with
 * a risk acknowledgement and consent. Every later lifecycle change is an operator action. Nothing here can create,
 * edit or upgrade a deterministic decision.
 */
export type PilotState = "NOT_INVITED" | "INVITED" | "ACTIVE" | "SUSPENDED" | "COMPLETED";
export type EnrollmentStatus = "ACTIVE" | "SUSPENDED" | "COMPLETED";
export const RISK_ACK_VERSION = "risk-ack-v1";
export const CONSENT_VERSION = "pilot-consent-v1";
export const DEFAULT_COHORT = "pilot-1";

export interface PilotInvite {
  email: string;
  cohort: string;
  invitedAt: number;
  revokedAt: number | null;
}

export interface PilotEnrollment {
  tenantId: string;
  status: EnrollmentStatus;
  cohort: string;
  activatedAt: number;
  riskAckVersion: string;
  consentVersion: string;
  statusChangedAt: number;
  statusReason: string | null;
}

/** Onboarding progress: timestamps only — never chart content, notes or prices. */
export interface OnboardingProgress {
  version: 1;
  evidenceModesAcknowledgedAt: number | null;
  dismissedAt: number | null;
}

export type Rating = 1 | 2 | 3 | 4 | 5;
export const PROBLEM_CATEGORIES = ["DATA", "CHART_READING", "DECISION_EXPLANATION", "ALERTS", "ACCOUNT", "OTHER"] as const;
export type ProblemCategory = (typeof PROBLEM_CATEGORIES)[number];

/** Structured pilot feedback. Always USER_REPORTED: a report is never itself a verified defect. */
export interface FeedbackEntry {
  feedbackId: string;
  tenantId: string;
  sessionId: string | null;
  recordId: string | null;
  at: number;
  kind: "USER_REPORTED";
  ratings: { clarity: Rating | null; confidence: Rating | null; usability: Rating | null; usefulness: Rating | null };
  missingInformation: string | null;
  problem: { category: ProblemCategory; description: string } | null;
}

export type TriageStatus = "NEW" | "ACKNOWLEDGED" | "DEFECT_CONFIRMED" | "NOT_A_DEFECT" | "NEEDS_INFO";
export interface FeedbackTriage {
  tenantId: string;
  feedbackId: string;
  status: TriageStatus;
  /** Verified defect register reference (KLY-n), only for DEFECT_CONFIRMED. */
  defectRef: string | null;
  reviewer: string;
  at: number;
}

export type OpsAuditAction = "pilot.invited" | "pilot.revoked" | "pilot.suspended" | "pilot.reinstated" | "pilot.completed" | "feedback.triaged" | "notification.requeued" | "runtime.quarantined" | "release.viewed";
export interface OpsAuditEntry {
  auditId: string;
  at: number;
  /** Hashed operator reference (op_…), never an email or user id. */
  operator: string;
  action: OpsAuditAction;
  detail: string;
}

/** User-bound pilot store (RLS in Supabase mode): scoped to the verified user on every call. */
export interface PilotStore {
  getInvite(email: string): Promise<PilotInvite | null>;
  getEnrollment(tenantId: string): Promise<PilotEnrollment | null>;
  /** Insert-only activation. false = an enrollment already exists. */
  activate(e: PilotEnrollment): Promise<boolean>;
  getOnboarding(tenantId: string): Promise<OnboardingProgress | null>;
  putOnboarding(tenantId: string, p: OnboardingProgress): Promise<void>;
  addFeedback(f: FeedbackEntry): Promise<boolean>;
  listFeedback(tenantId: string): Promise<FeedbackEntry[]>;
}

export function pilotStateOf(invite: PilotInvite | null, enrollment: PilotEnrollment | null): PilotState {
  if (enrollment) return enrollment.status;
  if (invite && invite.revokedAt === null) return "INVITED";
  return "NOT_INVITED";
}
