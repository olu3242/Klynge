import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Candle, TradingSession } from "../domain/types.ts";
import { replayInput } from "../replay/replay-test-fixtures.ts";
import type { ReplayFrame } from "../replay/types.ts";
import { scenario } from "../setup-test-fixtures.ts";
import { evaluate } from "../triggers/trigger-test-helpers.ts";
import type { KlyngeDecisionState } from "../triggers/types.ts";
import { CONSERVATIVE_EXECUTION, MIN_SAMPLE, mulberry32, partitionChronologically, runBacktest, simulateTrades, tradeStats } from "./backtest.ts";
import type { HypotheticalTrade } from "./backtest.ts";

const s = scenario();
const call = evaluate();
const put = evaluate({ side: "BEARISH" });
const M5 = 300_000;
const Te = s.now;
const cost = (p: number) => (p * (CONSERVATIVE_EXECUTION.halfSpreadBps + CONSERVATIVE_EXECUTION.slippageBps)) / 10_000;
const frame = (d: KlyngeDecisionState, at = Te): ReplayFrame => ({ timestamp: at, marketTruth: s.marketTruth, setupDecision: d });
/** Bar 0 closes at Te (the signal bar); later bars follow. Each spec: [open, high, low, close]. */
function session(specs: [number, number, number, number][]): TradingSession[] {
  const start = Te - M5;
  const candles: Candle[] = specs.map(([o, h, l, c], i) => ({ symbol: "TSLA", timeframe: "5m", timestamp: start + i * M5, open: o, high: h, low: l, close: c, volume: 1 }));
  return [{ sessionId: "d1", symbol: "TSLA", timeframe: "5m", openTimestamp: start, closeTimestamp: start + specs.length * M5, candles }];
}
const SIGNAL: [number, number, number, number] = [102, 102.2, 101.95, 102.1];
const risk = call.risk!;

describe("event-driven hypothetical execution (explicit assumptions)", () => {
  it("CALL fills at the NEXT bar open with spread+slippage; target exit nets costs", () => {
    const [t] = simulateTrades([frame(call)], session([SIGNAL, [102.1, 102.6, 102.05, 102.5], [102.5, 104.2, 102.4, 104]]));
    const entry = 102.1 + cost(102.1);
    const exit = 104 - cost(104);
    const r = entry - risk.invalidation!;
    assert.equal(t?.exitReason, "TARGET");
    assert.equal(t?.entryAt, Te);
    assert.ok(Math.abs(t!.entryPrice - entry) < 1e-12);
    assert.ok(Math.abs(t!.grossR - (exit - entry) / r) < 1e-9);
    assert.ok(Math.abs(t!.netR - (t!.grossR - (2 * CONSERVATIVE_EXECUTION.commissionPerShare) / r)) < 1e-12);
    assert.ok(t!.netR < t!.plannedRewardRisk, "costs reduce realized R");
  });
  it("stop before target when one bar touches both (conservative)", () => {
    const [t] = simulateTrades([frame(call)], session([SIGNAL, [102.1, 104.5, 101.5, 103]]));
    assert.equal(t?.exitReason, "STOP");
    assert.ok(t!.netR < -1);
  });
  it("a gap through the stop fills at the (worse) open", () => {
    const [t] = simulateTrades([frame(call)], session([SIGNAL, [102.1, 102.2, 102.0, 102.1], [101.0, 101.2, 100.8, 101.0]]));
    assert.equal(t?.exitReason, "STOP");
    assert.ok(Math.abs(t!.exitPrice - (101.0 - cost(101.0))) < 1e-12);
  });
  it("PUT mirrors", () => {
    const [t] = simulateTrades([frame(put)], session([[98, 98.05, 97.8, 97.9], [97.9, 97.95, 95.5, 96]]));
    assert.equal(t?.direction, "PUT");
    assert.equal(t?.exitReason, "TARGET");
    assert.ok(t!.netR > 0);
  });
  it("no fill when the signal comes on the session's last bar; session end closes open trades", () => {
    assert.deepEqual(simulateTrades([frame(call)], session([SIGNAL])), []);
    const [t] = simulateTrades([frame(call)], session([SIGNAL, [102.1, 102.3, 102.0, 102.2], [102.2, 102.4, 102.1, 102.3]]));
    assert.equal(t?.exitReason, "SESSION_END");
  });
  it("INVALIDATED exits at the next open; each setup trades once", () => {
    const inv = { ...call, decision: "INVALIDATED" as const };
    const bars = session([SIGNAL, [102.1, 102.3, 102.0, 102.2], [102.15, 102.3, 102.0, 102.1], [102.1, 102.2, 102.0, 102.1]]);
    const trades = simulateTrades([frame(call), frame(inv, Te + 2 * M5), frame(call, Te + 3 * M5)], bars);
    assert.equal(trades.length, 1);
    assert.equal(trades[0]!.exitReason, "INVALIDATED");
    assert.equal(trades[0]!.exitAt, Te + 2 * M5);
  });
  it("no lookahead: bars after the exit never change a completed trade", () => {
    const base = session([SIGNAL, [102.1, 102.6, 102.05, 102.5], [102.5, 104.2, 102.4, 104]]);
    const extended = session([SIGNAL, [102.1, 102.6, 102.05, 102.5], [102.5, 104.2, 102.4, 104], [300, 400, 1, 2], [2, 3, 1, 2]]);
    assert.deepEqual(simulateTrades([frame(call)], base), simulateTrades([frame(call)], extended));
  });
});

describe("statistics, uncertainty, partitions", () => {
  const t = (netR: number, plannedRewardRisk = 2, exitReason: HypotheticalTrade["exitReason"] = netR > 0 ? "TARGET" : "STOP") => ({ netR, plannedRewardRisk, exitReason }) as HypotheticalTrade;
  it("expectancy, drawdown, realization and a reproducible bootstrap interval", () => {
    const trades = [t(2), t(-1), t(-1), t(1.5), t(-1)];
    const a = tradeStats(trades);
    assert.equal(a.trades, 5);
    assert.equal(a.expectancyR, 0.1);
    assert.equal(a.maxDrawdownR, 2);
    assert.equal(a.winRate, 0.4);
    assert.ok(a.expectancyCi95![0] < 0.1 && a.expectancyCi95![1] > 0.1);
    assert.deepEqual(tradeStats(trades), a, "deterministic");
    assert.equal(a.insufficientSample, true, `n < ${MIN_SAMPLE}`);
    assert.equal(tradeStats([]).expectancyR, null);
  });
  it("deterministic PRNG", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  });
  it("chronological, disjoint partitions", () => {
    const p = partitionChronologically([5, 1, 3, 2, 4, 6, 7, 8, 9, 10]);
    assert.deepEqual([...p].sort((x, y) => x[0] - y[0]).map(([, v]) => v[0]), ["T", "T", "T", "T", "T", "T", "V", "V", "O", "O"]);
    assert.throws(() => partitionChronologically([1, 1]));
  });
});

describe("dataset backtest (replay day by day; synthetic is labelled)", () => {
  it("synthetic dataset => SYNTHETIC_NOT_EMPIRICAL, no performance claim, deterministic", () => {
    const ds = [{ name: "synthetic-bull", kind: "SYNTHETIC" as const, input: replayInput(), historySessions: 24 }];
    const a = runBacktest(ds);
    assert.equal(a.evidence, "SYNTHETIC_NOT_EMPIRICAL");
    assert.equal(a.performanceClaim, "NONE");
    assert.match(a.disclaimer, /SYNTHETIC data — not empirical evidence/);
    assert.equal(Object.values(a.decisionTime).reduce((x, y) => x + y, 0), a.frames);
    assert.ok(a.frames > 0 && a.setups >= 1);
    assert.equal(a.overall.insufficientSample, true);
    assert.deepEqual(runBacktest(ds), a);
  });
});
