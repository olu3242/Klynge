import { deepFreeze } from "../domain/freeze.ts";
import type { TradingSession } from "../domain/types.ts";
import { evaluateMarketTruth } from "../engine/market-truth.ts";
import type { MarketTruthSnapshot } from "../engine/market-truth.ts";
import type { DataQualityPolicy } from "../policies/data-quality-policy.ts";
import type { MarketContextPolicy } from "../policies/market-context-policy.ts";
import { assertValidTimeframePolicy, baseTimeframe, DEFAULT_TIMEFRAME_POLICY } from "../timeframe/hierarchy.ts";
import type { TimeframePolicy } from "../timeframe/hierarchy.ts";
import { buildMultiTimeframeState } from "../timeframe/multi-timeframe.ts";
import type { MultiTimeframeState } from "../timeframe/multi-timeframe.ts";
import { resampleSession } from "../timeframe/resample.ts";
import type { TimeframeSyncPolicy } from "../timeframe/sync.ts";
import { TIMEFRAME_MS } from "../timeframe/timeframe.ts";
import { evaluateSetup } from "../triggers/setup-engine.ts";
import type { KlyngeDecisionState, SetupPolicy } from "../triggers/types.ts";

export interface MultiTimeframePipelineInput {
  /** Base-timeframe sessions (finest role), ascending; last = current session. One feed per symbol. */
  target: readonly TradingSession[];
  spx: readonly TradingSession[];
  mnq: readonly TradingSession[];
  volumeProxy?: readonly TradingSession[];
  now: number;
  timeframePolicy?: TimeframePolicy;
  syncPolicy?: TimeframeSyncPolicy;
  setupPolicy?: SetupPolicy;
  dataQualityPolicy?: DataQualityPolicy;
  contextPolicy?: MarketContextPolicy;
  previous?: KlyngeDecisionState;
}

export interface MultiTimeframePipelineResult {
  marketTruth: MarketTruthSnapshot;
  multiTimeframe: MultiTimeframeState;
  setup: KlyngeDecisionState;
}

/** Derive the SETUP-timeframe view (closed buckets only) of a base feed. Partial derivations surface as data failures downstream. */
function setupView(sessions: readonly TradingSession[], policy: TimeframePolicy, now: number): TradingSession[] {
  return sessions.map((s) => {
    const r = resampleSession(s, policy.setup, now);
    // A closed bucket missing base bars must not silently disappear: drop the session's candles so the
    // engine reports NO_DATA / INSUFFICIENT data instead of analysing a hole.
    return r.failure ? { ...r.session, candles: [] } : r.session;
  });
}

/**
 * Multi-timeframe pipeline:
 *   base feeds -> SETUP-TF derivation -> market truth (with history) -> MTF state -> setup engine (HTF gate +
 *   execution context). The setup timeframe must evenly divide every session (validated).
 */
export function evaluateMultiTimeframeSetup(input: MultiTimeframePipelineInput): Readonly<MultiTimeframePipelineResult> {
  const policy = input.timeframePolicy ?? DEFAULT_TIMEFRAME_POLICY;
  assertValidTimeframePolicy(policy);
  const setupMs = TIMEFRAME_MS[policy.setup];
  for (const s of [...input.target, ...input.spx, ...input.mnq, ...(input.volumeProxy ?? [])]) {
    if (s.timeframe !== baseTimeframe(policy)) throw new RangeError(`pipeline: ${s.symbol} session ${s.sessionId} is ${s.timeframe}, expected base ${baseTimeframe(policy)}`);
    if ((s.closeTimestamp - s.openTimestamp) % setupMs !== 0) throw new RangeError(`pipeline: setup timeframe ${policy.setup} must evenly divide session ${s.sessionId}`);
  }
  const { now } = input;
  const dq = input.dataQualityPolicy;
  const split = (sessions: readonly TradingSession[]) => {
    const view = setupView(sessions, policy, now);
    return { current: view[view.length - 1] as TradingSession, history: view.slice(0, -1) };
  };
  const target = split(input.target);
  const spx = split(input.spx);
  const mnq = split(input.mnq);
  const proxy = input.volumeProxy ? split(input.volumeProxy) : undefined;

  const marketTruth = evaluateMarketTruth({
    spx: spx.current,
    mnq: mnq.current,
    spxHistory: spx.history,
    mnqHistory: mnq.history,
    now,
    ...(proxy ? { volumeProxy: proxy.current, volumeProxyHistory: proxy.history } : {}),
    ...(dq ? { policy: dq } : {}),
    ...(input.contextPolicy ? { contextPolicy: input.contextPolicy } : {}),
  });
  const multiTimeframe = buildMultiTimeframeState({
    sessions: input.target,
    now,
    policy,
    ...(input.syncPolicy ? { syncPolicy: input.syncPolicy } : {}),
    ...(dq ? { dataQualityPolicy: dq } : {}),
  });
  const prior = target.history[target.history.length - 1];
  const setup = evaluateSetup({
    marketTruth,
    target: target.current,
    targetHistory: target.history,
    ...(prior ? { priorSession: prior } : {}),
    now,
    multiTimeframe,
    ...(input.setupPolicy ? { policy: input.setupPolicy } : {}),
    ...(dq ? { dataQualityPolicy: dq } : {}),
    ...(input.previous ? { previous: input.previous } : {}),
  });
  return deepFreeze({ marketTruth, multiTimeframe, setup });
}
