import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { replayInput } from "../replay/replay-test-fixtures.ts";
import { DEFAULT_SETUP_POLICY } from "../triggers/setup-policy.ts";
import { approvePolicyChange, PolicyChangeError, proposePolicyChange, sensitivitySweep } from "./sensitivity.ts";
import type { SensitivityReport } from "./sensitivity.ts";

const datasets = [{ name: "synthetic-bull", source: "SYNTHETIC" as const, input: replayInput() }];

describe("deterministic policy calibration (report-only)", () => {
  const before = JSON.stringify(DEFAULT_SETUP_POLICY);
  const report = sensitivitySweep(datasets, "minimumRewardRiskRatio", [1.5, 3]);
  it("sweeps around the production default and describes decision frequencies", () => {
    assert.deepEqual(report.rows.map((r) => r.value), [1.5, DEFAULT_SETUP_POLICY.risk.minimumRewardRiskRatio, 3].sort((a, b) => a - b));
    assert.equal(report.rows.filter((r) => r.isProductionDefault).length, 1);
    for (const r of report.rows) assert.ok(Math.abs(r.waitRate + r.blockedRate + r.setupRate + r.invalidatedRate - 1) < 1e-9);
    assert.equal(report.area, "risk/reward constraint");
    assert.ok(Object.keys(report.blockerFrequency).length >= 0);
  });
  it("never changes production defaults; synthetic evidence is labelled", () => {
    assert.equal(JSON.stringify(DEFAULT_SETUP_POLICY), before);
    assert.equal(report.productionDefaultsChanged, false);
    assert.equal(report.approvalRequired, true);
    assert.equal(report.evidence, "SYNTHETIC_NOT_EMPIRICAL");
    assert.match(report.disclaimer, /not market evidence/);
  });
  it("reports are reproducible (content hash)", () => {
    assert.equal(sensitivitySweep(datasets, "minimumRewardRiskRatio", [1.5, 3]).reportHash, report.reportHash);
  });
  it("synthetic evidence cannot justify a change; empirical proposals need human approval + a new rule version", () => {
    assert.throws(() => proposePolicyChange(report, 3, "x".repeat(40), 1), PolicyChangeError);
    const empirical = { ...report, evidence: "EMPIRICAL_HISTORICAL" } as SensitivityReport;
    assert.throws(() => proposePolicyChange(empirical, 2.5, "x".repeat(40), 1), /not evaluated/);
    assert.throws(() => proposePolicyChange(empirical, 3, "short", 1), /rationale/);
    const p = proposePolicyChange(empirical, 3, "Fewer marginal setups on the out-of-sample partition.", 10);
    assert.equal(p.status, "PROPOSED");
    assert.throws(() => approvePolicyChange(p, { approver: "calibration-bot", approvedAt: 11, newRuleVersion: "production-calibration-v2" }), /human/);
    assert.throws(() => approvePolicyChange(p, { approver: "Ada Lovelace", approvedAt: 11, newRuleVersion: p.baseRuleVersion }), /new rule version/);
    const a = approvePolicyChange(p, { approver: "Ada Lovelace", approvedAt: 11, newRuleVersion: "production-calibration-v2" });
    assert.equal(a.status, "APPROVED_PENDING_RELEASE");
    assert.equal(JSON.stringify(DEFAULT_SETUP_POLICY), before, "approval alone changes nothing");
  });
});
