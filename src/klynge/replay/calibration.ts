import { deepFreeze } from "../domain/freeze.ts";
import { DEFAULT_SETUP_POLICY } from "../triggers/setup-policy.ts";
import type { KlyngeDecision, SetupPolicy } from "../triggers/types.ts";
import { labelReplayOutcomes } from "./outcomes.ts";
import { replaySession } from "./replay-engine.ts";
import type { ReplayInput, ReplayOutcome } from "./types.ts";

/** Experimental parameters exposed for calibration. Production defaults are never changed by a run. */
export interface CalibrationParameters {
  atrToleranceMultiplier?: number;
  minimumRewardRiskRatio?: number;
  maximumStopAtr?: number;
  acceptanceCloses?: number;
  minimumCloseDistanceAtr?: number;
  retestToleranceAtr?: number;
}

export function setupPolicyFromParameters(p: CalibrationParameters, base: SetupPolicy = DEFAULT_SETUP_POLICY): SetupPolicy {
  return {
    ...base,
    levels: { ...base.levels, ...(p.atrToleranceMultiplier !== undefined ? { atrToleranceMultiplier: p.atrToleranceMultiplier } : {}) },
    break: { ...base.break, ...(p.minimumCloseDistanceAtr !== undefined ? { minimumCloseDistanceAtr: p.minimumCloseDistanceAtr } : {}) },
    acceptance: { ...base.acceptance, ...(p.acceptanceCloses !== undefined ? { requiredCloses: p.acceptanceCloses } : {}) },
    retest: { ...base.retest, ...(p.retestToleranceAtr !== undefined ? { toleranceAtr: p.retestToleranceAtr } : {}) },
    risk: {
      ...base.risk,
      ...(p.minimumRewardRiskRatio !== undefined ? { minimumRewardRiskRatio: p.minimumRewardRiskRatio } : {}),
      ...(p.maximumStopAtr !== undefined ? { maximumStopAtr: p.maximumStopAtr } : {}),
    },
  };
}

export interface CalibrationDataset {
  name: string;
  /** SYNTHETIC fixtures cannot support conclusions about real markets. */
  source: "SYNTHETIC" | "HISTORICAL";
  input: ReplayInput;
}

export interface CalibrationVariant {
  name: string;
  parameters: CalibrationParameters;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
const tally = (keys: string[]) => keys.reduce<Record<string, number>>((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {});

export interface PolicyCalibrationReport {
  variant: string;
  parameters: CalibrationParameters;
  frames: number;
  decisionCounts: Record<KlyngeDecision, number>;
  setups: number;
  entered: number;
  callSetups: number;
  putSetups: number;
  targetReached: number;
  invalidationReached: number;
  unresolved: number;
  averageMae?: number;
  averageMfe?: number;
  averageRealizedRewardRisk?: number;
  averageDurationMs?: number;
  enteredByRegime: Record<string, number>;
  enteredByBias: Record<string, number>;
  outcomes: ReplayOutcome[];
}

export interface CalibrationReport {
  datasets: { name: string; source: CalibrationDataset["source"] }[];
  containsHistoricalData: boolean;
  disclaimer: string;
  /** Always false: calibration reports never mutate production defaults. */
  productionDefaultsChanged: false;
  reports: PolicyCalibrationReport[];
}

/**
 * Comparative, report-only policy calibration. Purpose: validate deterministic policy behavior and consistency,
 * NOT maximize historical profit. Results are hypothetical replays, never trading returns.
 */
export function runCalibration(datasets: readonly CalibrationDataset[], variants: readonly CalibrationVariant[]): Readonly<CalibrationReport> {
  const reports = variants.map((v): PolicyCalibrationReport => {
    const setupPolicy = setupPolicyFromParameters(v.parameters);
    const decisions: KlyngeDecision[] = [];
    const outcomes: ReplayOutcome[] = [];
    for (const ds of datasets) {
      const result = replaySession({ ...ds.input, setupPolicy });
      for (const f of result.frames) if (f.setupDecision) decisions.push(f.setupDecision.decision);
      outcomes.push(...labelReplayOutcomes(result, ds.input.target).map((o) => ({ ...o, setupId: `${ds.name}/${o.setupId}` })));
    }
    const entered = outcomes.filter((o) => o.entered);
    const counts = tally(decisions);
    return {
      variant: v.name,
      parameters: v.parameters,
      frames: decisions.length,
      decisionCounts: { CALL_SETUP: counts.CALL_SETUP ?? 0, PUT_SETUP: counts.PUT_SETUP ?? 0, WAIT: counts.WAIT ?? 0, BLOCKED: counts.BLOCKED ?? 0, INVALIDATED: counts.INVALIDATED ?? 0 },
      setups: outcomes.length,
      entered: entered.length,
      callSetups: entered.filter((o) => o.direction === "CALL").length,
      putSetups: entered.filter((o) => o.direction === "PUT").length,
      targetReached: entered.filter((o) => o.targetReached).length,
      invalidationReached: entered.filter((o) => o.invalidationReached).length,
      unresolved: entered.filter((o) => !o.targetReached && !o.invalidationReached).length,
      ...optional("averageMae", mean(entered.flatMap((o) => (o.mae === undefined ? [] : [o.mae])))),
      ...optional("averageMfe", mean(entered.flatMap((o) => (o.mfe === undefined ? [] : [o.mfe])))),
      ...optional("averageRealizedRewardRisk", mean(entered.flatMap((o) => (o.realizedRewardRisk === undefined ? [] : [o.realizedRewardRisk])))),
      ...optional("averageDurationMs", mean(entered.flatMap((o) => (o.durationMs === undefined ? [] : [o.durationMs])))),
      enteredByRegime: tally(entered.map((o) => o.regime ?? "UNKNOWN")),
      enteredByBias: tally(entered.map((o) => o.bias ?? "NONE")),
      outcomes,
    };
  });
  const containsHistoricalData = datasets.some((d) => d.source === "HISTORICAL");
  return deepFreeze({
    datasets: datasets.map((d) => ({ name: d.name, source: d.source })),
    containsHistoricalData,
    disclaimer: containsHistoricalData
      ? "Hypothetical replay of deterministic policy behavior on historical data. Not trading returns. Past behavior does not predict future outcomes."
      : "Hypothetical replay on SYNTHETIC data only. Validates deterministic behavior; supports no conclusion about real markets. Not trading returns.",
    productionDefaultsChanged: false as const,
    reports,
  });
}

function optional<K extends string>(key: K, value: number | undefined): Partial<Record<K, number>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, number>);
}
