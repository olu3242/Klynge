import { deepFreeze } from "../domain/freeze.ts";
import type { TradingSession } from "../domain/types.ts";
import { replaySession } from "../replay/replay-engine.ts";
import type { ReplayFrame, ReplayInput } from "../replay/types.ts";
import { TIMEFRAME_MS } from "../timeframe/timeframe.ts";

/**
 * EVALUATION ONLY. Event-driven hypothetical execution over replay frames: never feeds back into decisions, never
 * a performance promise. Every assumption is explicit in the ExecutionModel and recorded in the report.
 */
export interface ExecutionModel {
  /** Commission per share per fill (currency). */
  commissionPerShare: number;
  /** Half the bid/ask spread paid on every fill, basis points of price. */
  halfSpreadBps: number;
  /** Additional adverse slippage on every fill, basis points of price. */
  slippageBps: number;
  /** Time exit after this many bars in the trade. */
  maxHoldBars: number;
}

/** Documented hypothetical assumptions (conservative), not engine policy. */
export const CONSERVATIVE_EXECUTION: Readonly<ExecutionModel> = Object.freeze({ commissionPerShare: 0.005, halfSpreadBps: 2, slippageBps: 3, maxHoldBars: 36 });

export type ExitReason = "TARGET" | "STOP" | "INVALIDATED" | "TIME" | "SESSION_END";

export interface HypotheticalTrade {
  setupId: string;
  symbol: string;
  direction: "CALL" | "PUT";
  regime: string;
  timeframe: string;
  signalAt: number;
  entryAt: number;
  entryPrice: number;
  stop: number;
  target: number;
  plannedRewardRisk: number;
  exitAt: number;
  exitPrice: number;
  exitReason: ExitReason;
  grossR: number;
  netR: number;
  bars: number;
}

const bps = (price: number, b: number) => (price * b) / 10_000;

/**
 * Rules: a CALL_SETUP/PUT_SETUP frame (decided at a bar CLOSE) is filled at the NEXT bar's open in the same session,
 * plus half-spread and slippage against the trade. Exits: stop before target when one bar touches both
 * (conservative); a gap through the stop fills at the open; INVALIDATED exits at the next open; time exit and
 * session end exit at the close. One position at a time; each setup trades at most once. No overnight holds.
 */
export function simulateTrades(frames: readonly ReplayFrame[], sessions: readonly TradingSession[], model: ExecutionModel = CONSERVATIVE_EXECUTION): HypotheticalTrade[] {
  const trades: HypotheticalTrade[] = [];
  const traded = new Set<string>();
  const byClose = new Map<number, ReplayFrame>();
  for (const f of frames) byClose.set(f.timestamp, f);
  const cost = (p: number) => bps(p, model.halfSpreadBps + model.slippageBps);

  for (const session of sessions) {
    const bars = session.candles;
    let pending: { frame: ReplayFrame } | null = null;
    let pendingExit = false;
    let open: (Omit<HypotheticalTrade, "exitAt" | "exitPrice" | "exitReason" | "grossR" | "netR" | "bars"> & { held: number; riskPerShare: number; sign: 1 | -1 }) | null = null;
    const close = (exitAt: number, rawExit: number, reason: ExitReason) => {
      if (!open) return;
      const exitPrice = rawExit - open.sign * cost(rawExit);
      const gross = ((exitPrice - open.entryPrice) * open.sign) / open.riskPerShare;
      const net = gross - (2 * model.commissionPerShare) / open.riskPerShare;
      trades.push({
        setupId: open.setupId,
        symbol: open.symbol,
        direction: open.direction,
        regime: open.regime,
        timeframe: open.timeframe,
        signalAt: open.signalAt,
        entryAt: open.entryAt,
        entryPrice: open.entryPrice,
        stop: open.stop,
        target: open.target,
        plannedRewardRisk: open.plannedRewardRisk,
        exitAt,
        exitPrice,
        exitReason: reason,
        grossR: gross,
        netR: net,
        bars: open.held,
      });
      open = null;
      pendingExit = false;
    };
    for (const [i, b] of bars.entries()) {
      const tf = TIMEFRAME_MS[b.timeframe];
      const barClose = b.timestamp + tf;
      if (open && pendingExit) close(b.timestamp, b.open, "INVALIDATED");
      if (!open && pending) {
        const d = pending.frame.setupDecision;
        const r = d?.risk;
        pending = null;
        if (d && r?.invalidation !== undefined && r.target !== undefined && d.setup) {
          const sign: 1 | -1 = d.decision === "CALL_SETUP" ? 1 : -1;
          const entryPrice = b.open + sign * cost(b.open);
          const riskPerShare = Math.abs(entryPrice - r.invalidation);
          const stopOnWrongSide = sign === 1 ? r.invalidation >= entryPrice : r.invalidation <= entryPrice;
          if (riskPerShare > 0 && !stopOnWrongSide) {
            open = {
              setupId: d.setup.setupId,
              symbol: d.symbol,
              direction: sign === 1 ? "CALL" : "PUT",
              regime: d.regime,
              timeframe: d.timeframe,
              signalAt: d.provenance.evaluatedAt,
              entryAt: b.timestamp,
              entryPrice,
              stop: r.invalidation,
              target: r.target,
              plannedRewardRisk: Math.abs(r.target - entryPrice) / riskPerShare,
              held: 0,
              riskPerShare,
              sign,
            };
          }
        }
      }
      if (open) {
        open.held++;
        const o = open;
        const hitStop = o.sign === 1 ? b.low <= o.stop : b.high >= o.stop;
        const hitTarget = o.sign === 1 ? b.high >= o.target : b.low <= o.target;
        const gapThrough = o.sign === 1 ? b.open <= o.stop : b.open >= o.stop;
        if (hitStop) close(barClose, gapThrough ? b.open : o.stop, "STOP");
        else if (hitTarget) close(barClose, o.target, "TARGET");
        else if (o.held >= model.maxHoldBars) close(barClose, b.close, "TIME");
        else if (i === bars.length - 1) close(barClose, b.close, "SESSION_END");
      }
      const f = byClose.get(barClose);
      const d = f?.setupDecision;
      if (open && d && (d.decision === "INVALIDATED" || d.decision === "BLOCKED") && d.setup?.setupId === open.setupId) pendingExit = i < bars.length - 1;
      if (!open && f && d && (d.decision === "CALL_SETUP" || d.decision === "PUT_SETUP") && d.setup && !traded.has(d.setup.setupId) && i < bars.length - 1) {
        traded.add(d.setup.setupId);
        pending = { frame: f };
      }
    }
  }
  return trades;
}

/** Deterministic PRNG (mulberry32) — reproducible bootstrap, no Math.random. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface TradeStats {
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  expectancyR: number | null;
  /** 95% bootstrap interval for expectancy (2 000 resamples, fixed seed). */
  expectancyCi95: [number, number] | null;
  maxDrawdownR: number;
  averagePlannedRewardRisk: number | null;
  /** Mean realized/planned R on target exits. */
  rewardRiskRealization: number | null;
  exits: Record<ExitReason, number>;
  insufficientSample: boolean;
}

export const MIN_SAMPLE = 30;

export function tradeStats(trades: readonly HypotheticalTrade[], seed = 42): TradeStats {
  const r = trades.map((t) => t.netR);
  const n = r.length;
  const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  let peak = 0;
  let equity = 0;
  let mdd = 0;
  for (const x of r) {
    equity += x;
    peak = Math.max(peak, equity);
    mdd = Math.max(mdd, peak - equity);
  }
  let ci: [number, number] | null = null;
  if (n >= 2) {
    const rand = mulberry32(seed);
    const means: number[] = [];
    for (let k = 0; k < 2000; k++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += r[Math.floor(rand() * n)] as number;
      means.push(s / n);
    }
    means.sort((a, b) => a - b);
    ci = [means[49] as number, means[1949] as number];
  }
  const targets = trades.filter((t) => t.exitReason === "TARGET");
  const exits: Record<ExitReason, number> = { TARGET: 0, STOP: 0, INVALIDATED: 0, TIME: 0, SESSION_END: 0 };
  for (const t of trades) exits[t.exitReason]++;
  return {
    trades: n,
    wins: r.filter((x) => x > 0).length,
    losses: r.filter((x) => x <= 0).length,
    winRate: n ? r.filter((x) => x > 0).length / n : null,
    expectancyR: n ? mean(r) : null,
    expectancyCi95: ci,
    maxDrawdownR: mdd,
    averagePlannedRewardRisk: n ? mean(trades.map((t) => t.plannedRewardRisk)) : null,
    rewardRiskRealization: targets.length ? mean(targets.map((t) => t.netR / t.plannedRewardRisk)) : null,
    exits,
    insufficientSample: n < MIN_SAMPLE,
  };
}

export type Partition = "TRAIN" | "VALIDATION" | "OUT_OF_SAMPLE";

/** Chronological, disjoint partitions over ordered day keys (no shuffling, no overlap). */
export function partitionChronologically(dayKeys: readonly number[], split = { train: 0.6, validation: 0.2 }): Map<number, Partition> {
  const days = [...dayKeys].sort((a, b) => a - b);
  for (let i = 1; i < days.length; i++) if (days[i] === days[i - 1]) throw new RangeError("partition: duplicate day key");
  const nTrain = Math.floor(days.length * split.train);
  const nVal = Math.floor(days.length * split.validation);
  return new Map(days.map((d, i) => [d, i < nTrain ? "TRAIN" : i < nTrain + nVal ? "VALIDATION" : "OUT_OF_SAMPLE"]));
}

export interface BacktestDataset {
  name: string;
  kind: "HISTORICAL" | "SYNTHETIC";
  /** Multi-session feeds; every session from `historySessions` onwards is replayed as a trading day. */
  input: ReplayInput;
  historySessions: number;
}

export interface BacktestReport {
  datasets: { name: string; kind: BacktestDataset["kind"]; days: number }[];
  evidence: "EMPIRICAL_HISTORICAL" | "SYNTHETIC_NOT_EMPIRICAL";
  execution: ExecutionModel;
  frames: number;
  decisionTime: { WAIT: number; BLOCKED: number; INVALIDATED: number; CALL_SETUP: number; PUT_SETUP: number };
  setups: number;
  invalidatedSetups: number;
  trades: HypotheticalTrade[];
  overall: TradeStats;
  byPartition: Record<Partition, TradeStats>;
  byRegime: Record<string, TradeStats>;
  byTicker: Record<string, TradeStats>;
  byTimeframe: Record<string, TradeStats>;
  disclaimer: string;
  /** Always "NONE": reports are descriptive and never a claim of profitability. */
  performanceClaim: "NONE";
}

const group = (trades: readonly HypotheticalTrade[], key: (t: HypotheticalTrade) => string) => {
  const m = new Map<string, HypotheticalTrade[]>();
  for (const t of trades) m.set(key(t), [...(m.get(key(t)) ?? []), t]);
  return Object.fromEntries([...m].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, tradeStats(v)]));
};

/** Day-by-day replay (no lookahead: each day sees only sessions up to that day) → hypothetical trades → statistics. */
export function runBacktest(datasets: readonly BacktestDataset[], model: ExecutionModel = CONSERVATIVE_EXECUTION): Readonly<BacktestReport> {
  const trades: HypotheticalTrade[] = [];
  const decisionTime = { WAIT: 0, BLOCKED: 0, INVALIDATED: 0, CALL_SETUP: 0, PUT_SETUP: 0 };
  const setupIds = new Set<string>();
  const invalidated = new Set<string>();
  const dayOfTrade = new Map<HypotheticalTrade, number>();
  const summary: BacktestReport["datasets"] = [];
  let frames = 0;
  for (const ds of datasets) {
    const n = ds.input.target.length;
    let days = 0;
    for (let d = ds.historySessions; d < n; d++) {
      const cut = (feed: readonly TradingSession[] | undefined) => (feed ? feed.slice(0, d + 1) : undefined);
      const proxy = cut(ds.input.volumeProxy);
      const dayInput: ReplayInput = { ...ds.input, target: cut(ds.input.target) as TradingSession[], spx: cut(ds.input.spx) as TradingSession[], mnq: cut(ds.input.mnq) as TradingSession[], ...(proxy ? { volumeProxy: proxy } : {}) };
      const result = replaySession(dayInput);
      days++;
      frames += result.frames.length;
      for (const f of result.frames) {
        const s = f.setupDecision;
        if (!s) continue;
        decisionTime[s.decision]++;
        if (s.setup) setupIds.add(`${ds.name}/${s.setup.setupId}`);
        if (s.decision === "INVALIDATED" && s.setup) invalidated.add(`${ds.name}/${s.setup.setupId}`);
      }
      const day = ds.input.target[d] as TradingSession;
      for (const t of simulateTrades(result.frames, [day], model)) {
        const tagged = { ...t, setupId: `${ds.name}/${t.setupId}` };
        trades.push(tagged);
        dayOfTrade.set(tagged, day.openTimestamp);
      }
    }
    summary.push({ name: ds.name, kind: ds.kind, days });
  }
  const partitions = partitionChronologically([...new Set(datasets.flatMap((ds) => ds.input.target.slice(ds.historySessions).map((s) => s.openTimestamp)))]);
  const inPart = (p: Partition) => trades.filter((t) => partitions.get(dayOfTrade.get(t) as number) === p);
  const synthetic = datasets.some((d) => d.kind === "SYNTHETIC") || datasets.length === 0;
  return deepFreeze({
    datasets: summary,
    evidence: synthetic ? ("SYNTHETIC_NOT_EMPIRICAL" as const) : ("EMPIRICAL_HISTORICAL" as const),
    execution: { ...model },
    frames,
    decisionTime,
    setups: setupIds.size,
    invalidatedSetups: invalidated.size,
    trades,
    overall: tradeStats(trades),
    byPartition: { TRAIN: tradeStats(inPart("TRAIN")), VALIDATION: tradeStats(inPart("VALIDATION")), OUT_OF_SAMPLE: tradeStats(inPart("OUT_OF_SAMPLE")) },
    byRegime: group(trades, (t) => t.regime),
    byTicker: group(trades, (t) => t.symbol),
    byTimeframe: group(trades, (t) => t.timeframe),
    disclaimer: `${synthetic ? "SYNTHETIC data — not empirical evidence. " : ""}Hypothetical execution under the stated assumptions; not trading results, not a recommendation, not financial advice. Past behaviour does not predict future outcomes.`,
    performanceClaim: "NONE" as const,
  });
}
