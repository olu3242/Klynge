import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Candle, TradingSession } from "../domain/types.ts";
import { BULL_BARS, scenario } from "../setup-test-fixtures.ts";
import { DEFAULT_SETUP_POLICY } from "../triggers/setup-policy.ts";
import { evaluate } from "../triggers/trigger-test-helpers.ts";
import { runCalibration, setupPolicyFromParameters } from "./calibration.ts";
import { labelReplayOutcomes } from "./outcomes.ts";
import { replayInput } from "./replay-test-fixtures.ts";
import type { ReplayResult } from "./types.ts";

const s = scenario();
const call = evaluate(); // entry zone [102.025, 102.183], invalidation ≈101.867, target 104
const put = evaluate({ side: "BEARISH" });
const Te = s.now;
const entry = (call.risk!.entryZone!.min + call.risk!.entryZone!.max) / 2;
const riskPts = entry - call.risk!.invalidation!;

function feedAfter(bars: [number, number][], symbol = "TSLA"): TradingSession[] {
  const candles: Candle[] = bars.map(([h, l], i) => ({ symbol, timeframe: "5m", timestamp: Te + i * 300_000, open: (h + l) / 2, high: h, low: l, close: (h + l) / 2, volume: 1 }));
  return [{ sessionId: "x", symbol, timeframe: "5m", openTimestamp: Te, closeTimestamp: Te + 1e7, candles }];
}
const result = (decision = call): ReplayResult => ({ symbol: "TSLA", frames: [{ timestamp: Te, marketTruth: s.marketTruth, setupDecision: decision }] });

describe("replay outcomes (evaluation only, hypothetical)", () => {
  it("target reached => realized R = reward / risk", () => {
    const [o] = labelReplayOutcomes(result(), feedAfter([[102.5, 102.0], [104.1, 102.3]]));
    assert.equal(o?.entered, true);
    assert.equal(o?.targetReached, true);
    assert.equal(o?.invalidationReached, false);
    assert.equal(o?.realizedRewardRisk, (104 - entry) / riskPts);
    assert.equal(o?.resolvedAt, Te + 600_000);
    assert.equal(o?.durationMs, 600_000);
    assert.equal(o?.regime, "RISK_ON");
  });
  it("invalidation reached => R = −1", () => {
    const [o] = labelReplayOutcomes(result(), feedAfter([[102.3, 101.8]]));
    assert.equal(o?.invalidationReached, true);
    assert.equal(o?.realizedRewardRisk, -1);
  });
  it("same bar hits both => invalidation first (conservative)", () => {
    const [o] = labelReplayOutcomes(result(), feedAfter([[104.5, 101.5]]));
    assert.equal(o?.invalidationReached, true);
    assert.equal(o?.targetReached, false);
  });
  it("unresolved => no realized R, MAE/MFE tracked", () => {
    const [o] = labelReplayOutcomes(result(), feedAfter([[102.6, 101.95], [102.9, 102.0]]));
    assert.equal(o?.realizedRewardRisk, undefined);
    assert.equal(o?.resolvedAt, undefined);
    assert.ok(Math.abs((o?.mae ?? 0) - (entry - 101.95)) < 1e-12);
    assert.ok(Math.abs((o?.mfe ?? 0) - (102.9 - entry)) < 1e-12);
  });
  it("PUT outcomes mirror", () => {
    const pe = (put.risk!.entryZone!.min + put.risk!.entryZone!.max) / 2;
    const [o] = labelReplayOutcomes(result(put), feedAfter([[pe + 0.1, 95.9]]));
    assert.equal(o?.direction, "PUT");
    assert.equal(o?.targetReached, true);
  });
  it("never-entered lifecycles are recorded with entered = false", () => {
    const forming = evaluate({ bars: BULL_BARS.slice(0, 26) }); // WAIT with an active (ACCEPTED) lifecycle
    const [o] = labelReplayOutcomes(result(forming), feedAfter([[110, 90]]));
    assert.equal(o?.entered, false);
    assert.equal(o?.decision, "WAIT");
  });
});

describe("policy calibration (report only)", () => {
  const datasets = [
    { name: "bull", source: "SYNTHETIC" as const, input: replayInput("BULLISH", []) },
    { name: "bear", source: "SYNTHETIC" as const, input: replayInput("BEARISH", []) },
  ];
  const before = JSON.stringify(DEFAULT_SETUP_POLICY);
  const report = runCalibration(datasets, [
    { name: "A (defaults)", parameters: {} },
    { name: "B (R:R 100)", parameters: { minimumRewardRiskRatio: 100 } },
    { name: "C (3 acceptance closes, wider tolerance)", parameters: { acceptanceCloses: 3, atrToleranceMultiplier: 0.35 } },
  ]);
  it("produces a comparative report per policy", () => {
    assert.deepEqual(report.reports.map((r) => r.variant), ["A (defaults)", "B (R:R 100)", "C (3 acceptance closes, wider tolerance)"]);
    for (const r of report.reports) {
      const total = Object.values(r.decisionCounts).reduce((a, b) => a + b, 0);
      assert.equal(total, r.frames);
      assert.equal(r.frames, 168);
    }
  });
  it("policy A reaches CALL and PUT setups; policy B's R:R blocks every entry", () => {
    const [a, b] = report.reports;
    assert.ok(a!.decisionCounts.CALL_SETUP >= 1 && a!.decisionCounts.PUT_SETUP >= 1);
    assert.equal(a!.callSetups, 1);
    assert.equal(a!.putSetups, 1);
    assert.equal(b!.entered, 0);
    assert.equal(b!.decisionCounts.CALL_SETUP + b!.decisionCounts.PUT_SETUP, 0);
    assert.ok(b!.decisionCounts.BLOCKED > a!.decisionCounts.BLOCKED);
  });
  it("tracks regime and bias of entries", () => assert.deepEqual(report.reports[0]!.enteredByRegime, { RISK_ON: 1, RISK_OFF: 1 }));
  it("never changes production defaults and labels synthetic data honestly", () => {
    assert.equal(report.productionDefaultsChanged, false);
    assert.equal(JSON.stringify(DEFAULT_SETUP_POLICY), before);
    assert.equal(report.containsHistoricalData, false);
    assert.match(report.disclaimer, /SYNTHETIC data only/);
    assert.match(report.disclaimer, /Not trading returns/);
  });
  it("experimental parameters map onto the canonical policy", () => {
    const p = setupPolicyFromParameters({ atrToleranceMultiplier: 0.4, minimumRewardRiskRatio: 3, maximumStopAtr: 1, acceptanceCloses: 4 });
    assert.equal(p.levels.atrToleranceMultiplier, 0.4);
    assert.equal(p.risk.minimumRewardRiskRatio, 3);
    assert.equal(p.risk.maximumStopAtr, 1);
    assert.equal(p.acceptance.requiredCloses, 4);
    assert.deepEqual(setupPolicyFromParameters({}), DEFAULT_SETUP_POLICY);
  });
  it("is deterministic", () => assert.equal(JSON.stringify(runCalibration(datasets.slice(0, 1), [{ name: "A", parameters: {} }])), JSON.stringify(runCalibration(datasets.slice(0, 1), [{ name: "A", parameters: {} }]))));
});

