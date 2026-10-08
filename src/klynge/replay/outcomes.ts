import type { Candle, TradingSession } from "../domain/types.ts";
import { TIMEFRAME_MS } from "../timeframe/timeframe.ts";
import type { ReplayOutcome, ReplayResult } from "./types.ts";

/**
 * EVALUATION ONLY — labels what happened after each setup using later bars. Never fed back into decisions.
 * Hypothetical: entry = entry-zone midpoint at the first CALL/PUT frame; same-bar target+invalidation counts as
 * invalidation (conservative). R: target => reward/risk, invalidation => −1, unresolved => undefined.
 */
export function labelReplayOutcomes(result: ReplayResult, targetFeed: readonly TradingSession[]): ReplayOutcome[] {
  const bars: Candle[] = (targetFeed[targetFeed.length - 1]?.candles ?? []).slice();
  const ids: string[] = [];
  for (const f of result.frames) {
    const id = f.setupDecision?.setup?.setupId;
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids.map((setupId) => {
    const frames = result.frames.filter((f) => f.setupDecision?.setup?.setupId === setupId);
    const lastFrame = frames[frames.length - 1];
    const entryFrame = frames.find((f) => f.setupDecision?.decision === "CALL_SETUP" || f.setupDecision?.decision === "PUT_SETUP");
    const setup = (entryFrame ?? lastFrame)?.setupDecision;
    const identity = setup?.setup;
    const base: ReplayOutcome = {
      setupId,
      decision: setup?.decision ?? "WAIT",
      entered: false,
      targetReached: false,
      invalidationReached: false,
      startedAt: identity?.startedAt ?? 0,
      direction: identity?.direction ?? "CALL",
    };
    const risk = entryFrame?.setupDecision?.risk;
    if (!entryFrame || !risk?.entryZone || risk.invalidation === undefined || risk.target === undefined) return base;

    const bull = base.direction === "CALL";
    const entry = (risk.entryZone.min + risk.entryZone.max) / 2;
    const riskPts = Math.abs(entry - risk.invalidation);
    let mae = 0;
    let mfe = 0;
    const out: ReplayOutcome = {
      ...base,
      entered: true,
      entryTimestamp: entryFrame.timestamp,
      ...(entryFrame.setupDecision ? { regime: entryFrame.setupDecision.regime } : {}),
      ...(entryFrame.multiTimeframe ? { bias: entryFrame.multiTimeframe.bias } : {}),
    };
    for (const b of bars.filter((c) => c.timestamp >= entryFrame.timestamp)) {
      const adverse = bull ? entry - b.low : b.high - entry;
      const favorable = bull ? b.high - entry : entry - b.low;
      mae = Math.max(mae, adverse);
      mfe = Math.max(mfe, favorable);
      const close = b.timestamp + TIMEFRAME_MS[b.timeframe];
      if (bull ? b.low <= risk.invalidation : b.high >= risk.invalidation) {
        Object.assign(out, { invalidationReached: true, resolvedAt: close, realizedRewardRisk: -1 });
        break;
      }
      if (bull ? b.high >= risk.target : b.low <= risk.target) {
        Object.assign(out, { targetReached: true, resolvedAt: close, realizedRewardRisk: Math.abs(risk.target - entry) / riskPts });
        break;
      }
    }
    out.mae = mae;
    out.mfe = mfe;
    if (out.resolvedAt !== undefined) out.durationMs = out.resolvedAt - (out.entryTimestamp as number);
    return out;
  });
}
