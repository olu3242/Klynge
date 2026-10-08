import { deepFreeze } from "../domain/freeze.ts";
import type { Candle } from "../domain/types.ts";
import { evaluateOptions } from "../options/eligibility.ts";
import type { OptionChainSnapshot } from "../options/types.ts";
import { evaluateMultiTimeframeSetup } from "../pipeline/mtf-pipeline.ts";
import { TIMEFRAME_MS } from "../timeframe/timeframe.ts";
import type { KlyngeDecisionState } from "../triggers/types.ts";
import { assertAsOf, assertFrameAsOf, candleCloseTimes, feedAsOf } from "./as-of.ts";
import type { ReplayFrame, ReplayInput, ReplayResult } from "./types.ts";

/** Latest chain snapshot taken at or before `asOf` for `underlying` (never a future snapshot). */
export function chainAsOf(chains: readonly OptionChainSnapshot[], underlying: string, asOf: number): OptionChainSnapshot | undefined {
  let best: OptionChainSnapshot | undefined;
  for (const c of chains) if (c.underlying === underlying && c.timestamp <= asOf && (!best || c.timestamp > best.timestamp)) best = c;
  return best;
}

/** Frame at `asOf` reconstructed ONLY from data knowable at `asOf`. */
export function replayFrameAt(input: ReplayInput, asOf: number, previous?: KlyngeDecisionState): Readonly<ReplayFrame> {
  const target = feedAsOf(input.target, asOf);
  const spx = feedAsOf(input.spx, asOf);
  const mnq = feedAsOf(input.mnq, asOf);
  const proxy = input.volumeProxy ? feedAsOf(input.volumeProxy, asOf) : undefined;
  assertAsOf(asOf, [...candleCloseTimes(target), ...candleCloseTimes(spx), ...candleCloseTimes(mnq), ...(proxy ? candleCloseTimes(proxy) : [])], "replay input candle close");

  const { optionChains, optionsPolicy, ...pipelineInput } = input;
  const result = evaluateMultiTimeframeSetup({ ...pipelineInput, target, spx, mnq, ...(proxy ? { volumeProxy: proxy } : {}), now: asOf, ...(previous ? { previous } : {}) });
  const symbol = target[target.length - 1]?.symbol ?? "";
  const chain = optionChains ? chainAsOf(optionChains, symbol, asOf) : undefined;
  const optionsDecision = chain
    ? evaluateOptions({ setup: result.setup, chain, now: asOf, underlyingPrice: result.multiTimeframe.execution?.price ?? Number.NaN, ...(optionsPolicy ? { policy: optionsPolicy } : {}) })
    : undefined;
  const frame: ReplayFrame = {
    timestamp: asOf,
    marketTruth: result.marketTruth,
    multiTimeframe: result.multiTimeframe,
    setupDecision: result.setup,
    ...(optionsDecision ? { optionsDecision } : {}),
  };
  assertFrameAsOf(frame);
  return deepFreeze(frame);
}

/**
 * Replay the current (last) target session bar by bar. Frame clock = each base-candle close, strictly increasing.
 * Each frame is computed from truncated inputs (no future data can be reached) and chains `previous` so
 * lifecycles end exactly as they would have live.
 */
export function replaySession(input: ReplayInput): Readonly<ReplayResult> {
  const current = input.target[input.target.length - 1];
  if (!current) throw new RangeError("replay: target feed is empty");
  const clock = current.candles.map((c: Candle) => c.timestamp + TIMEFRAME_MS[c.timeframe]);
  const frames: ReplayFrame[] = [];
  let previous: KlyngeDecisionState | undefined;
  for (const T of clock) {
    const last = frames[frames.length - 1];
    if (last && !(T > last.timestamp)) throw new RangeError("replay clock must advance monotonically");
    const frame = replayFrameAt(input, T, previous);
    frames.push(frame);
    previous = frame.setupDecision;
  }
  return deepFreeze({ symbol: current.symbol, frames });
}
