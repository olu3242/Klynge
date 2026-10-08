import { deepFreeze } from "../domain/freeze.ts";
import { canonicalJson, sha256Hex } from "../history/sha256.ts";
import { runCalibration, setupPolicyFromParameters } from "../replay/calibration.ts";
import type { CalibrationDataset, CalibrationParameters } from "../replay/calibration.ts";
import { replaySession } from "../replay/replay-engine.ts";
import { DEFAULT_SETUP_POLICY } from "../triggers/setup-policy.ts";
import { KLYNGE_RULE_VERSION } from "../engine/version.ts";

/**
 * Offline, report-only policy calibration. Sensitivity sweeps vary ONE parameter around the production default and
 * describe how decisions change. Nothing here can modify production thresholds; a change requires a proposal, an
 * explicit human approval and a new rule version shipped in code.
 */
export type SweepParameter = keyof CalibrationParameters;

const DEFAULT_OF: Record<SweepParameter, number> = {
  atrToleranceMultiplier: DEFAULT_SETUP_POLICY.levels.atrToleranceMultiplier,
  minimumRewardRiskRatio: DEFAULT_SETUP_POLICY.risk.minimumRewardRiskRatio,
  maximumStopAtr: DEFAULT_SETUP_POLICY.risk.maximumStopAtr,
  acceptanceCloses: DEFAULT_SETUP_POLICY.acceptance.requiredCloses,
  minimumCloseDistanceAtr: DEFAULT_SETUP_POLICY.break.minimumCloseDistanceAtr,
  retestToleranceAtr: DEFAULT_SETUP_POLICY.retest.toleranceAtr,
};

/** Which behaviour each parameter governs (VWAP/EMA/structure/regime/MTF are attributed via blocker frequencies). */
export const PARAMETER_AREA: Readonly<Record<SweepParameter, string>> = Object.freeze({
  atrToleranceMultiplier: "level clustering",
  minimumCloseDistanceAtr: "break",
  acceptanceCloses: "acceptance",
  retestToleranceAtr: "retest",
  maximumStopAtr: "ATR-based invalidation",
  minimumRewardRiskRatio: "risk/reward constraint",
});

export interface SensitivityRow {
  value: number;
  isProductionDefault: boolean;
  frames: number;
  waitRate: number;
  blockedRate: number;
  setupRate: number;
  invalidatedRate: number;
  entered: number;
  targetReached: number;
  invalidationReached: number;
  averageRealizedRewardRisk: number | null;
}

export interface SensitivityReport {
  parameter: SweepParameter;
  area: string;
  productionDefault: number;
  rows: SensitivityRow[];
  /** Frequency of each blocker/reason code across frames at the production default (regime, MTF, VWAP/EMA, structure…). */
  blockerFrequency: Record<string, number>;
  datasets: { name: string; source: CalibrationDataset["source"] }[];
  evidence: "EMPIRICAL_HISTORICAL" | "SYNTHETIC_NOT_EMPIRICAL";
  ruleVersion: string;
  productionDefaultsChanged: false;
  approvalRequired: true;
  reportHash: string;
  disclaimer: string;
}

export function sensitivitySweep(datasets: readonly CalibrationDataset[], parameter: SweepParameter, values: readonly number[]): Readonly<SensitivityReport> {
  const def = DEFAULT_OF[parameter];
  const sweep = [...new Set([...values, def])].sort((a, b) => a - b);
  const report = runCalibration(datasets, sweep.map((v) => ({ name: `${parameter}=${v}`, parameters: { [parameter]: v } })));
  const rows: SensitivityRow[] = report.reports.map((r, i) => {
    const total = Math.max(1, r.frames);
    return {
      value: sweep[i] as number,
      isProductionDefault: sweep[i] === def,
      frames: r.frames,
      waitRate: r.decisionCounts.WAIT / total,
      blockedRate: r.decisionCounts.BLOCKED / total,
      setupRate: (r.decisionCounts.CALL_SETUP + r.decisionCounts.PUT_SETUP) / total,
      invalidatedRate: r.decisionCounts.INVALIDATED / total,
      entered: r.entered,
      targetReached: r.targetReached,
      invalidationReached: r.invalidationReached,
      averageRealizedRewardRisk: r.averageRealizedRewardRisk ?? null,
    };
  });
  const blockerFrequency: Record<string, number> = {};
  const policy = setupPolicyFromParameters({});
  for (const ds of datasets) {
    for (const f of replaySession({ ...ds.input, setupPolicy: policy }).frames) {
      for (const b of f.setupDecision?.blockers ?? []) blockerFrequency[b] = (blockerFrequency[b] ?? 0) + 1;
    }
  }
  const synthetic = !datasets.length || datasets.some((d) => d.source === "SYNTHETIC");
  const body = { parameter, rows, blockerFrequency, datasets: report.datasets, ruleVersion: KLYNGE_RULE_VERSION };
  return deepFreeze({
    parameter,
    area: PARAMETER_AREA[parameter],
    productionDefault: def,
    rows,
    blockerFrequency: Object.fromEntries(Object.entries(blockerFrequency).sort(([a], [b]) => a.localeCompare(b))),
    datasets: report.datasets,
    evidence: synthetic ? ("SYNTHETIC_NOT_EMPIRICAL" as const) : ("EMPIRICAL_HISTORICAL" as const),
    ruleVersion: KLYNGE_RULE_VERSION,
    productionDefaultsChanged: false as const,
    approvalRequired: true as const,
    reportHash: sha256Hex(canonicalJson(body)),
    disclaimer: `${synthetic ? "SYNTHETIC data — describes engine behaviour only, not market evidence. " : ""}Descriptive sensitivity analysis; not a recommendation; production thresholds are unchanged.`,
  });
}

export interface PolicyChangeProposal {
  proposalId: string;
  parameter: SweepParameter;
  from: number;
  to: number;
  rationale: string;
  evidenceReportHash: string;
  baseRuleVersion: string;
  createdAt: number;
  status: "PROPOSED";
}

export interface PolicyChangeApproval {
  proposal: PolicyChangeProposal;
  approver: string;
  approvedAt: number;
  /** The new rule version the change must ship under (code change + KLYNGE_RULE_HISTORY entry). */
  newRuleVersion: string;
  status: "APPROVED_PENDING_RELEASE";
}

export class PolicyChangeError extends Error {
  override readonly name = "PolicyChangeError";
}

/** A proposal needs empirical (non-synthetic) evidence and a stated rationale. It changes nothing by itself. */
export function proposePolicyChange(report: SensitivityReport, to: number, rationale: string, at: number): Readonly<PolicyChangeProposal> {
  if (report.evidence !== "EMPIRICAL_HISTORICAL") throw new PolicyChangeError("synthetic evidence cannot justify a production policy change");
  if (!report.rows.some((r) => r.value === to)) throw new PolicyChangeError("proposed value was not evaluated in the evidence report");
  if (to === report.productionDefault) throw new PolicyChangeError("proposal does not change the production default");
  if (rationale.trim().length < 20) throw new PolicyChangeError("a written rationale is required");
  return deepFreeze({
    proposalId: sha256Hex(`${report.reportHash}|${report.parameter}|${to}|${at}`).slice(0, 16),
    parameter: report.parameter,
    from: report.productionDefault,
    to,
    rationale: rationale.trim(),
    evidenceReportHash: report.reportHash,
    baseRuleVersion: report.ruleVersion,
    createdAt: at,
    status: "PROPOSED" as const,
  });
}

/** Explicit human approval with versioned provenance. Defaults remain frozen until a release ships the change. */
export function approvePolicyChange(proposal: PolicyChangeProposal, input: { approver: string; approvedAt: number; newRuleVersion: string }): Readonly<PolicyChangeApproval> {
  if (!/^[a-zA-Z0-9._@ -]{3,80}$/.test(input.approver) || /agent|bot|automat/i.test(input.approver)) throw new PolicyChangeError("approval requires a named human approver");
  if (input.newRuleVersion === proposal.baseRuleVersion || !/^[a-z0-9-]+-v\d+$/.test(input.newRuleVersion)) throw new PolicyChangeError("approval requires a new rule version");
  if (input.approvedAt < proposal.createdAt) throw new PolicyChangeError("approval cannot predate the proposal");
  return deepFreeze({ proposal, approver: input.approver, approvedAt: input.approvedAt, newRuleVersion: input.newRuleVersion, status: "APPROVED_PENDING_RELEASE" as const });
}
