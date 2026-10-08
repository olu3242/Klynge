import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { EnrollmentActions, InviteForm, RequeueButton, TriageForm } from "@/components/admin-pilot";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { requestContext } from "@/server/http";
import { isOperator } from "@/server/ops/operator";
import { controlPlane } from "@/server/pilot/control-plane";
import { clockFrom, processDeps } from "@/server/runtime";
import type { MemorySessionStore } from "@/server/store/memory-store";

export const dynamic = "force-dynamic";

const iso = (t: number | null) => (t ? new Date(t).toISOString().replace(".000Z", "Z") : "—");

/** Restricted pilot control plane (Batch 78). Operators only; every action is audited and isolated from decisions. */
export default async function PilotAdminPage() {
  const ctx = await requestContext({ pilotGate: false });
  if (ctx.identity.kind !== "USER" || !isOperator(ctx.identity, ctx.gateway.kind)) notFound();
  const p = processDeps();
  const v = controlPlane({ storeMode: p.storeMode, durable: (p.durable as MemorySessionStore | null) ?? null, account: p.account, market: ctx.deps.market ?? null, pilot: p.pilot }, clockFrom(await headers()));
  return (
    <AppShell active="ops" account={{ email: ctx.identity.user.email, authEnabled: true, operator: true }}>
      <h1 className="text-3xl font-extrabold tracking-tight">Pilot administration</h1>
      <Card aria-labelledby="rel-title" data-testid="admin-release" data-verdict={v.release.verdict} className="mt-6">
        <CardTitle id="rel-title">Release</CardTitle>
        <p className="mt-2 text-sm">
          <Badge tone={v.release.verdict === "BLOCKED" ? "danger" : "neutral"}>{v.release.verdict}</Badge> release {v.release.release} · rules {v.release.ruleVersion} · app {v.release.appVersion} · deployment {v.release.deploymentAuthorized ? "authorized" : "not authorized"}
          {v.release.pendingMigrations.length > 0 && ` · migrations awaiting separate authorization: ${v.release.pendingMigrations.join(", ")}`}
          {v.release.failedChecks.length > 0 && ` · failed checks: ${v.release.failedChecks.join(", ")}`}
        </p>
      </Card>
      {v.scope === "HOSTED" ? (
        <Card aria-labelledby="hosted-title" className="mt-6">
          <CardTitle id="hosted-title">Hosted pilot</CardTitle>
          <p className="mt-2 text-sm">Hosted enrollment, triage and audit run through the allow-listed operator script (`npm run pilot:admin`), never on a request path.</p>
        </Card>
      ) : (
        <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6">
          <Card aria-labelledby="inv-title" data-testid="admin-invites">
            <CardTitle id="inv-title">Invitations</CardTitle>
            <InviteForm />
            <ul className="mt-3 grid gap-1 text-sm">
              {v.invites.map((i) => (
                <li key={i.email} className="break-words">
                  {i.email} · {i.cohort} · invited {iso(i.invitedAt)} {i.revokedAt ? `· revoked ${iso(i.revokedAt)}` : ""}
                </li>
              ))}
            </ul>
          </Card>
          <Card aria-labelledby="enr-title" data-testid="admin-enrollments">
            <CardTitle id="enr-title">Enrollments</CardTitle>
            <ul className="mt-3 grid gap-2 text-sm">
              {v.enrollments.map((e) => (
                <li key={e.tenantRef} data-ref={e.tenantRef} data-status={e.status} className="flex flex-wrap items-center gap-3">
                  <span>
                    {e.tenantRef} · {e.cohort} · <Badge tone={e.status === "ACTIVE" ? "success" : "neutral"}>{e.status}</Badge> since {iso(e.statusChangedAt)}
                  </span>
                  <EnrollmentActions tenantRef={e.tenantRef} status={e.status} />
                </li>
              ))}
            </ul>
          </Card>
          <Card aria-labelledby="fbk-title" data-testid="admin-feedback">
            <CardTitle id="fbk-title">Feedback and support (user-reported — not verified defects)</CardTitle>
            <ul className="mt-3 grid gap-4 text-sm">
              {v.feedback.map((f) => (
                <li key={f.feedbackId} data-feedback={f.feedbackId} data-triage={f.triage?.status ?? "NEW"} className="break-words">
                  <span className="text-k-secondary">
                    {iso(f.at)} · {f.tenantRef} · clarity {f.ratings.clarity ?? "—"} · confidence {f.ratings.confidence ?? "—"} · usability {f.ratings.usability ?? "—"} · usefulness {f.ratings.usefulness ?? "—"}
                  </span>
                  {f.missingInformation && <span className="block">Missing: {f.missingInformation}</span>}
                  {f.problem && (
                    <span className="block">
                      Problem ({f.problem.category}): {f.problem.description}
                    </span>
                  )}
                  <span className="block text-k-secondary">Triage: {f.triage ? `${f.triage.status}${f.triage.defectRef ? ` ${f.triage.defectRef}` : ""} by ${f.triage.reviewer}` : "NEW"}</span>
                  <TriageForm tenantRef={f.tenantRef} feedbackId={f.feedbackId} current={f.triage?.status ?? "NEW"} />
                </li>
              ))}
            </ul>
          </Card>
          <Card aria-labelledby="jobs-title" data-testid="admin-jobs">
            <CardTitle id="jobs-title">Failed jobs and data-quality incidents</CardTitle>
            <ul className="mt-3 grid gap-1 text-sm">
              {v.incidents.map((i) => (
                <li key={`${i.code}-${i.severity}`}>
                  {i.severity} {i.code} × {i.count} — {i.runbook}
                </li>
              ))}
              {v.deadLetters.map((d) => (
                <li key={d.notificationId} className="flex flex-wrap items-center gap-2">
                  Dead letter {d.event} {d.symbol} · attempts {d.attempts} · {d.lastError ?? ""} <RequeueButton notificationId={d.notificationId} />
                </li>
              ))}
              {v.incidents.length === 0 && v.deadLetters.length === 0 && <li>No failed jobs or incidents.</li>}
            </ul>
          </Card>
          <Card aria-labelledby="ana-title" data-testid="admin-analytics">
            <CardTitle id="ana-title">Pilot analytics (aggregates; satisfaction is not accuracy)</CardTitle>
            <p className="mt-2 text-sm">
              DATA evaluations {v.analytics.decisions.dataEvaluations} · WAIT/BLOCKED rate {v.analytics.decisions.waitOrBlockedRate ?? "—"} · setups {v.analytics.setups.total} · corrections {v.analytics.corrections.edits + v.analytics.corrections.confirmations} · sessions started {v.analytics.sessions.started} (complete sets {v.analytics.sessions.completeChartSet}, abandoned {v.analytics.sessions.abandoned}) · feedback {v.analytics.satisfaction.responses} · accuracy {v.analytics.accuracy.status} · hypothetical outcomes {v.analytics.hypotheticalOutcomes.status}
            </p>
          </Card>
          <Card aria-labelledby="oa-title" data-testid="admin-audit">
            <CardTitle id="oa-title">Operational audit history</CardTitle>
            <ul className="mt-3 grid gap-1 text-sm">
              {v.opsAudit.map((a) => (
                <li key={a.auditId}>
                  {iso(a.at)} · {a.operator} · {a.action} · {a.detail}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </AppShell>
  );
}
