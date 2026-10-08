import { CONSERVATIVE_EXECUTION, MIN_SAMPLE, simulateTrades, tradeStats } from "../backtest/backtest.ts";
import type { BacktestDataset, ExecutionModel, HypotheticalTrade, TradeStats } from "../backtest/backtest.ts";
import { deepFreeze } from "../domain/freeze.ts";
import type { TradingSession } from "../domain/types.ts";
import { KLYNGE_ENGINE_VERSION, KLYNGE_RULE_VERSION } from "../engine/version.ts";
import { canonicalJson, sha256Hex } from "../history/sha256.ts";
import { replaySession } from "../replay/replay-engine.ts";
import type { ReplayFrame, ReplayInput } from "../replay/types.ts";
import type { KlyngeDecision } from "../triggers/types.ts";

/**
 * EVALUATION ONLY (Batches 65–66). Empirical replay analytics, a sealed chronological holdout, cost sensitivity and an
 * out-of-sample report. Nothing here feeds back into decisions or changes thresholds; outputs are descriptive, carry
 * their evidence label, and never claim profitability or statistical significance.
 */

export type EvaluationPartition = "TRAIN" | "VALIDATION" | "HOLDOUT";
type DecisionCounts = Record<KlyngeDecision, number>;
const zero = (): DecisionCounts => ({ WAIT: 0, BLOCKED: 0, INVALIDATED: 0, CALL_SETUP: 0, PUT_SETUP: 0 });

export interface ReplayedDay {
  dataset: string;
  kind: BacktestDataset["kind"];
  day: number;
  session: TradingSession;
  frames: readonly ReplayFrame[];
}

/** One replay per trading day; each day sees only sessions up to and including itself (no lookahead). */
export function replayDays(datasets: readonly BacktestDataset[]): ReplayedDay[] {
  const out: ReplayedDay[] = [];
  for (const ds of datasets) {
    for (let d = ds.historySessions; d < ds.input.target.length; d++) {
      const cut = (feed: readonly TradingSession[] | undefined) => (feed ? feed.slice(0, d + 1) : undefined);
      const proxy = cut(ds.input.volumeProxy);
      const input: ReplayInput = { ...ds.input, target: cut(ds.input.target) as TradingSession[], spx: cut(ds.input.spx) as TradingSession[], mnq: cut(ds.input.mnq) as TradingSession[], ...(proxy ? { volumeProxy: proxy } : {}) };
      const session = ds.input.target[d] as TradingSession;
      out.push({ dataset: ds.name, kind: ds.kind, day: session.openTimestamp, session, frames: replaySession(input).frames });
    }
  }
  return out;
}

// ── 65: decision analytics ───────────────────────────────────────────────────────────────────────────────────────

export interface DecisionAnalytics {
  frames: number;
  decisions: DecisionCounts;
  byTicker: Record<string, DecisionCounts>;
  byTimeframe: Record<string, DecisionCounts>;
  byRegime: Record<string, DecisionCounts>;
  /** Setup frames whose direction agreed with the market context, per regime. */
  regimeAlignment: Record<string, { setupFrames: number; aligned: number }>;
  /** Decision changes between consecutive frames of the same day ("FROM->TO": count). */
  transitions: Record<string, number>;
  /** Setups that later invalidated: bars from first setup frame to invalidation, and stop distance in ATR. */
  invalidation: { setups: number; invalidated: number; barsToInvalidation: number[]; stopDistanceAtr: number[] };
  /** Blocker codes on BLOCKED frames; `risk` counts the risk-engine vetoes among them. */
  vetoes: { blocked: number; byCode: Record<string, number>; risk: Record<string, number> };
}

const bump = <K extends string>(m: Record<K, number>, k: K) => {
  m[k] = (m[k] ?? 0) + 1;
};
const sortKeys = <T>(o: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

export function decisionAnalytics(days: readonly ReplayedDay[]): Readonly<DecisionAnalytics> {
  const a: DecisionAnalytics = { frames: 0, decisions: zero(), byTicker: {}, byTimeframe: {}, byRegime: {}, regimeAlignment: {}, transitions: {}, invalidation: { setups: 0, invalidated: 0, barsToInvalidation: [], stopDistanceAtr: [] }, vetoes: { blocked: 0, byCode: {}, risk: {} } };
  for (const day of days) {
    let prev: KlyngeDecision | null = null;
    const firstSetup = new Map<string, number>();
    const closed = new Set<string>();
    day.frames.forEach((f, idx) => {
      const d = f.setupDecision;
      if (!d) return;
      a.frames++;
      a.decisions[d.decision]++;
      for (const [bucket, key] of [[a.byTicker, d.symbol], [a.byTimeframe, d.timeframe], [a.byRegime, d.regime]] as const) (bucket[key] ??= zero())[d.decision]++;
      if (prev !== null && prev !== d.decision) bump(a.transitions, `${prev}->${d.decision}`);
      prev = d.decision;
      if (d.decision === "CALL_SETUP" || d.decision === "PUT_SETUP") {
        const r = (a.regimeAlignment[d.regime] ??= { setupFrames: 0, aligned: 0 });
        r.setupFrames++;
        if (d.marketAligned) r.aligned++;
        if (d.setup && !firstSetup.has(d.setup.setupId)) {
          firstSetup.set(d.setup.setupId, idx);
          a.invalidation.setups++;
          if (d.risk?.stopDistance !== undefined && d.risk.atr14 > 0) a.invalidation.stopDistanceAtr.push(d.risk.stopDistance / d.risk.atr14);
        }
      }
      if (d.decision === "INVALIDATED" && d.setup && firstSetup.has(d.setup.setupId) && !closed.has(d.setup.setupId)) {
        closed.add(d.setup.setupId);
        a.invalidation.invalidated++;
        a.invalidation.barsToInvalidation.push(idx - (firstSetup.get(d.setup.setupId) as number));
      }
      if (d.decision === "BLOCKED") {
        a.vetoes.blocked++;
        for (const b of d.blockers) bump(a.vetoes.byCode, b);
        for (const b of d.risk?.blockers ?? []) bump(a.vetoes.risk, b);
      }
    });
  }
  return deepFreeze({
    ...a,
    byTicker: sortKeys(a.byTicker),
    byTimeframe: sortKeys(a.byTimeframe),
    byRegime: sortKeys(a.byRegime),
    regimeAlignment: sortKeys(a.regimeAlignment),
    transitions: sortKeys(a.transitions),
    vetoes: { blocked: a.vetoes.blocked, byCode: sortKeys(a.vetoes.byCode), risk: sortKeys(a.vetoes.risk) },
  });
}

// ── 66: sealed chronological holdout ─────────────────────────────────────────────────────────────────────────────

export class HoldoutViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HoldoutViolation";
  }
}

export interface HoldoutSeal {
  /** Ordered, unique trading-day keys (session open timestamps). */
  days: readonly number[];
  trainEnd: number;
  validationEnd: number;
  /** First holdout day; nothing at or after this may be used for calibration. */
  holdoutStart: number;
  holdoutDays: number;
  sealedAt: number;
  /** SHA-256 of the partition definition — recorded with any calibration that claims to respect it. */
  sealHash: string;
}

/** Chronological train / validation / holdout. Fixed before any analysis; the holdout is never used to calibrate. */
export function sealHoldout(dayKeys: readonly number[], sealedAt: number, split = { train: 0.6, validation: 0.2 }): Readonly<HoldoutSeal> {
  const days = [...dayKeys].sort((x, y) => x - y);
  for (let i = 1; i < days.length; i++) if (days[i] === days[i - 1]) throw new RangeError("holdout: duplicate day key");
  const nTrain = Math.floor(days.length * split.train);
  const nVal = Math.floor(days.length * split.validation);
  if (nTrain < 1 || nVal < 1 || days.length - nTrain - nVal < 1) throw new RangeError("holdout: each partition needs at least one trading day");
  const body = { days, nTrain, nVal };
  return deepFreeze({ days, trainEnd: days[nTrain - 1] as number, validationEnd: days[nTrain + nVal - 1] as number, holdoutStart: days[nTrain + nVal] as number, holdoutDays: days.length - nTrain - nVal, sealedAt, sealHash: sha256Hex(canonicalJson(body)) });
}

export function partitionOf(seal: HoldoutSeal, day: number): EvaluationPartition {
  return day <= seal.trainEnd ? "TRAIN" : day <= seal.validationEnd ? "VALIDATION" : "HOLDOUT";
}

/** Truncate a dataset to pre-holdout sessions for calibration. Throws if asked to calibrate on holdout data. */
export function calibrationView(ds: BacktestDataset, seal: HoldoutSeal): BacktestDataset {
  const keep = (feed: readonly TradingSession[] | undefined) => (feed ? feed.filter((s) => s.openTimestamp < seal.holdoutStart) : undefined);
  const target = keep(ds.input.target) as TradingSession[];
  if (target.length <= ds.historySessions) throw new HoldoutViolation(`${ds.name}: no pre-holdout trading days remain for calibration`);
  const proxy = keep(ds.input.volumeProxy);
  return { ...ds, input: { ...ds.input, target, spx: keep(ds.input.spx) as TradingSession[], mnq: keep(ds.input.mnq) as TradingSession[], ...(proxy ? { volumeProxy: proxy } : {}) } };
}

export function assertNoHoldout(days: readonly ReplayedDay[], seal: HoldoutSeal): void {
  const leaked = days.filter((d) => d.day >= seal.holdoutStart);
  if (leaked.length) throw new HoldoutViolation(`calibration input contains ${leaked.length} holdout day(s) — the holdout is sealed`);
}

// ── 66: costs, out-of-sample report ──────────────────────────────────────────────────────────────────────────────

export const scaleCosts = (m: ExecutionModel, k: number): ExecutionModel => ({ ...m, commissionPerShare: m.commissionPerShare * k, halfSpreadBps: m.halfSpreadBps * k, slippageBps: m.slippageBps * k });

const tradesFor = (days: readonly ReplayedDay[], model: ExecutionModel) =>
  days.flatMap((d) => simulateTrades(d.frames, [d.session], model).map((t) => ({ trade: { ...t, setupId: `${d.dataset}/${t.setupId}` }, day: d.day })));

export interface CostSensitivityRow {
  multiplier: number;
  execution: ExecutionModel;
  overall: TradeStats;
  holdout: TradeStats;
}

export function costSensitivity(days: readonly ReplayedDay[], seal: HoldoutSeal, multipliers: readonly number[] = [0, 1, 2], model: ExecutionModel = CONSERVATIVE_EXECUTION): CostSensitivityRow[] {
  return multipliers.map((k) => {
    const exec = scaleCosts(model, k);
    const t = tradesFor(days, exec);
    return { multiplier: k, execution: exec, overall: tradeStats(t.map((x) => x.trade)), holdout: tradeStats(t.filter((x) => partitionOf(seal, x.day) === "HOLDOUT").map((x) => x.trade)) };
  });
}

export interface OutOfSampleReport {
  engineVersion: string;
  ruleVersion: string;
  evidence: "EMPIRICAL_HISTORICAL" | "SYNTHETIC_NOT_EMPIRICAL";
  seal: HoldoutSeal;
  lookahead: string;
  execution: ExecutionModel;
  partitions: Record<EvaluationPartition, { days: number; analytics: DecisionAnalytics; stats: TradeStats }>;
  costSensitivity: CostSensitivityRow[];
  /** Underlying hypothetical outcomes only; option outcomes are separate and need licensed historical chains. */
  underlying: { trades: number; byRegime: Record<string, TradeStats>; byTicker: Record<string, TradeStats>; byTimeframe: Record<string, TradeStats> };
  options: { status: "NOT_EVALUATED"; reason: string };
  uncertainty: { minimumSample: number; holdoutInsufficient: boolean; expectancyCi95Holdout: [number, number] | null };
  significance: { status: "NOT_ASSESSED"; reason: string };
  performanceClaim: "NONE";
  reportHash: string;
  disclaimer: string;
}

const groupStats = (trades: readonly HypotheticalTrade[], key: (t: HypotheticalTrade) => string) => {
  const m = new Map<string, HypotheticalTrade[]>();
  for (const t of trades) m.set(key(t), [...(m.get(key(t)) ?? []), t]);
  return Object.fromEntries([...m].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, tradeStats(v)]));
};

export function outOfSampleReport(days: readonly ReplayedDay[], seal: HoldoutSeal, model: ExecutionModel = CONSERVATIVE_EXECUTION): Readonly<OutOfSampleReport> {
  for (const d of days) if (!seal.days.includes(d.day)) throw new HoldoutViolation(`day ${d.day} is not in the sealed partition`);
  const tagged = tradesFor(days, model);
  const part = (p: EvaluationPartition) => {
    const ds = days.filter((d) => partitionOf(seal, d.day) === p);
    return { days: new Set(ds.map((d) => d.day)).size, analytics: decisionAnalytics(ds), stats: tradeStats(tagged.filter((x) => partitionOf(seal, x.day) === p).map((x) => x.trade)) };
  };
  const partitions = { TRAIN: part("TRAIN"), VALIDATION: part("VALIDATION"), HOLDOUT: part("HOLDOUT") };
  const trades = tagged.map((x) => x.trade);
  const synthetic = days.length === 0 || days.some((d) => d.kind === "SYNTHETIC");
  const body = {
    engineVersion: KLYNGE_ENGINE_VERSION,
    ruleVersion: KLYNGE_RULE_VERSION,
    evidence: synthetic ? ("SYNTHETIC_NOT_EMPIRICAL" as const) : ("EMPIRICAL_HISTORICAL" as const),
    seal,
    lookahead: "NONE: each day replays only sessions up to itself; fills at the next bar open; partitions are chronological and sealed before analysis",
    execution: { ...model },
    partitions,
    costSensitivity: costSensitivity(days, seal, [0, 1, 2], model),
    underlying: { trades: trades.length, byRegime: groupStats(trades, (t) => t.regime), byTicker: groupStats(trades, (t) => t.symbol), byTimeframe: groupStats(trades, (t) => t.timeframe) },
    options: { status: "NOT_EVALUATED" as const, reason: "Option outcomes require licensed historical option chains; underlying outcomes are not option outcomes." },
    uncertainty: { minimumSample: MIN_SAMPLE, holdoutInsufficient: partitions.HOLDOUT.stats.insufficientSample, expectancyCi95Holdout: partitions.HOLDOUT.stats.expectancyCi95 },
    significance: { status: "NOT_ASSESSED" as const, reason: partitions.HOLDOUT.stats.insufficientSample ? `holdout sample below ${MIN_SAMPLE} trades` : "no pre-registered hypothesis or multiple-comparison control; bootstrap intervals describe uncertainty only" },
    performanceClaim: "NONE" as const,
  };
  return deepFreeze({
    ...body,
    reportHash: sha256Hex(canonicalJson(body)),
    disclaimer: `${synthetic ? "SYNTHETIC data — not empirical evidence. " : ""}Hypothetical, descriptive out-of-sample evaluation under stated assumptions; not trading results, not a recommendation, not financial advice. No profitability or statistical significance is claimed.`,
  });
}
