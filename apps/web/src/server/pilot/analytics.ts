import type { OutboxItem } from "../account/types.ts";
import type { DecisionRecord, StoredSession } from "../store/types.ts";
import { evidenceClass } from "./evidence.ts";
import type { EvidenceClass } from "./evidence.ts";
import type { FeedbackEntry, OnboardingProgress, PilotEnrollment } from "./types.ts";

/**
 * Internal pilot analytics (Batch 75). Aggregates only. User satisfaction is reported separately from — and is never a
 * proxy for — predictive accuracy; hypothetical outcomes come only from verified historical datasets (scripts/
 * calibrate.ts, sealed holdout). No profitability claim is ever made.
 */
export interface PilotAnalyticsInputs {
  now: number;
  records: readonly DecisionRecord[];
  sessions: readonly StoredSession[];
  alerts: readonly { event: string; at: number }[];
  outbox: readonly OutboxItem[];
  feedback: readonly FeedbackEntry[];
  onboarding: readonly (OnboardingProgress & { tenantId: string })[];
  enrollments: readonly PilotEnrollment[];
  /** Summary of a verified-historical out-of-sample report, when one exists. */
  hypothetical?: { evidence: string; trades: number; holdoutInsufficient: boolean } | null;
}

const inc = (m: Record<string, number>, k: string, n = 1) => {
  m[k] = (m[k] ?? 0) + n;
};
const sorted = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).sort(([a], [b]) => a.localeCompare(b)));
const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);

export function pilotAnalytics(i: PilotAnalyticsInputs) {
  const data = i.records.filter((r) => r.evidenceMode === "DATA" && r.data);
  const visual = i.records.filter((r) => r.evidenceMode === "VISUAL" && r.visual);
  const decisions: Record<string, number> = {};
  for (const r of data) inc(decisions, r.data!.decision);
  const setups = data.filter((r) => r.data!.decision === "CALL_SETUP" || r.data!.decision === "PUT_SETUP");
  const by = (f: (r: DecisionRecord) => string | null) => {
    const m: Record<string, number> = {};
    for (const r of setups) inc(m, f(r) ?? "UNKNOWN");
    return sorted(m);
  };
  const blockers: Record<string, number> = {};
  for (const r of data) if (r.data!.decision === "BLOCKED") for (const b of r.data!.blockers) inc(blockers, b);
  const visualPermissions: Record<string, number> = {};
  for (const r of visual) inc(visualPermissions, r.visual!.permission);
  const classes: Record<EvidenceClass, number> = { SYNTHETIC_FIXTURE: 0, USER_SCREENSHOT: 0, USER_IMPORTED_DATA: 0, VERIFIED_LIVE: 0 };
  for (const r of i.records) classes[evidenceClass(r)]++;
  const charts = i.sessions.flatMap((s) => s.charts);
  const edits = charts.flatMap((c) => c.audit).filter((a) => a.action === "EDIT").length;
  const confirms = charts.flatMap((c) => c.audit).filter((a) => a.action === "CONFIRM").length;
  const started = i.sessions.filter((s) => s.charts.length > 0);
  const completeSet = started.filter((s) => ["TARGET", "SPX", "MNQ"].every((role) => s.charts.some((c) => c.role === role)));
  const dataSessions = new Set(data.map((r) => `${r.tenantId}|${r.sessionId}`));
  const abandoned = started.filter((s) => !completeSet.includes(s) && i.now - Math.max(...s.charts.map((c) => c.uploadedAt)) > 86_400_000);
  const ratings = (k: keyof FeedbackEntry["ratings"]) => i.feedback.map((f) => f.ratings[k]).filter((x): x is NonNullable<typeof x> => x !== null);
  const problems: Record<string, number> = {};
  for (const f of i.feedback) if (f.problem) inc(problems, f.problem.category);
  const count = (s: OutboxItem["status"]) => i.outbox.filter((o) => o.status === s).length;
  const rate = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 1000 : null);
  return {
    generatedAt: i.now,
    decisions: { dataEvaluations: data.length, byDecision: sorted(decisions), waitOrBlockedRate: rate((decisions.WAIT ?? 0) + (decisions.BLOCKED ?? 0), data.length), visualAnalyses: visual.length, visualPermissions: sorted(visualPermissions) },
    setups: { total: setups.length, byTicker: by((r) => r.symbol), byTimeframe: by((r) => r.timeframe), byRegime: by((r) => r.data!.regime) },
    dataQuality: { providerFailures: i.alerts.filter((a) => a.event === "PROVIDER_FAILURE").length, blockedByCode: sorted(blockers), degradedProvenance: data.filter((r) => (r.marketData ?? []).some((p) => !p.normalized || p.warnings.length > 0)).length },
    evidence: classes,
    corrections: { charts: charts.length, confirmations: confirms, edits, editsPerChart: rate(edits, charts.length) },
    alerts: { raised: i.alerts.length, delivered: count("DELIVERED"), failed: count("FAILED"), suppressed: count("SUPPRESSED"), pending: count("PENDING"), alertProblemReports: problems.ALERTS ?? 0 },
    sessions: { started: started.length, completeChartSet: completeSet.length, dataConnected: dataSessions.size, abandoned: abandoned.length, completionRate: rate(completeSet.length, started.length) },
    enrollment: { active: i.enrollments.filter((e) => e.status === "ACTIVE").length, suspended: i.enrollments.filter((e) => e.status === "SUSPENDED").length, completed: i.enrollments.filter((e) => e.status === "COMPLETED").length, onboardingAcknowledged: i.onboarding.filter((o) => o.evidenceModesAcknowledgedAt !== null).length },
    satisfaction: { responses: i.feedback.length, clarity: mean(ratings("clarity")), confidence: mean(ratings("confidence")), usability: mean(ratings("usability")), usefulness: mean(ratings("usefulness")), problemsByCategory: sorted(problems) },
    accuracy: { status: "NOT_MEASURED_BY_FEEDBACK" as const, note: "User satisfaction is not predictive accuracy. Hypothetical outcomes are measured only on verified historical data with a sealed holdout." },
    hypotheticalOutcomes: i.hypothetical && i.hypothetical.evidence === "EMPIRICAL_HISTORICAL" ? { status: "AVAILABLE" as const, ...i.hypothetical } : { status: "NOT_AVAILABLE" as const, reason: "No verified historical dataset has been evaluated (synthetic fixtures are not evidence)." },
    performanceClaim: "NONE" as const,
  };
}
export type PilotAnalytics = ReturnType<typeof pilotAnalytics>;
