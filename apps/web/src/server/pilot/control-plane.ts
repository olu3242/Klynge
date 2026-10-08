import path from "node:path";
import { collectOpsReport } from "../ops/operator.ts";
import type { OpsDeps } from "../ops/operator.ts";
import { actualState, loadManifest, releaseReadiness } from "../release/manifest.ts";
import type { ReleaseVerdict } from "../release/manifest.ts";
import { adminView } from "./admin.ts";
import type { AdminStores, AdminView } from "./admin.ts";
import { pilotAnalytics } from "./analytics.ts";

export interface ReleaseStatus {
  release: string;
  engineVersion: string;
  ruleVersion: string;
  appVersion: string;
  verdict: ReleaseVerdict | "MANIFEST_UNAVAILABLE";
  failedChecks: string[];
  pendingMigrations: string[];
  approvals: string[];
  deploymentAuthorized: boolean;
}

/** Release visibility for operators (read-only; computed from the deployed code and its manifest). */
export function releaseStatus(appRoot = process.cwd()): ReleaseStatus {
  const actual = actualState(appRoot);
  const dir = path.resolve(appRoot, "../../releases");
  const m = loadManifest(dir, actual.engineVersion);
  const base = { release: actual.engineVersion, engineVersion: actual.engineVersion, ruleVersion: actual.ruleVersion, appVersion: actual.appVersion };
  if (!m) return { ...base, verdict: "MANIFEST_UNAVAILABLE", failedChecks: [], pendingMigrations: [], approvals: [], deploymentAuthorized: false };
  const r = releaseReadiness(m, m.previousRelease ? loadManifest(dir, m.previousRelease) : null, actual);
  return { ...base, verdict: r.verdict, failedChecks: r.checks.filter((c) => !c.ok).map((c) => c.id), pendingMigrations: r.pendingMigrations, approvals: m.approvals.map((a) => a.role), deploymentAuthorized: m.authorizations.deployment.approved };
}

export function controlPlane(d: OpsDeps & { pilot: AdminStores["pilot"] | null }, now: number): (AdminView & { release: ReleaseStatus; scope: "IN_PROCESS" }) | { scope: "HOSTED"; release: ReleaseStatus } {
  const release = releaseStatus();
  if (!d.pilot || !d.durable) return { scope: "HOSTED", release };
  const ops = collectOpsReport(d, now);
  const snap = d.durable.infrastructureSnapshot();
  const analytics = pilotAnalytics({ now, records: snap.records, sessions: snap.sessions, alerts: snap.alerts, outbox: d.account?.allOutbox() ?? [], feedback: d.pilot.allFeedback(), onboarding: d.pilot.allOnboarding(), enrollments: d.pilot.allEnrollments(), hypothetical: null });
  return { ...adminView({ pilot: d.pilot, account: d.account, durable: d.durable }, ops, analytics), release, scope: "IN_PROCESS" };
}
