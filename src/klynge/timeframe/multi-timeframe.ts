import { mergeUnique } from "../domain/blockers.ts";
import type { BlockerCode } from "../domain/blockers.ts";
import { deepFreeze } from "../domain/freeze.ts";
import type { Direction, TechnicalState, Timeframe, TradingSession } from "../domain/types.ts";
import { validateCandle } from "../data-quality/candle-validation.ts";
import { assessSessionQuality, dataQualityFailure, mergeDataQuality } from "../data-quality/series-quality.ts";
import { classifyDirection } from "../engine/direction.ts";
import { assembleTechnicalState, assessSessionHistory } from "../engine/technical-state.ts";
import { DEFAULT_DATA_QUALITY_POLICY, effectiveMinimumCandles } from "../policies/data-quality-policy.ts";
import type { DataQualityPolicy } from "../policies/data-quality-policy.ts";
import { deriveHigherTimeframeBias } from "./bias.ts";
import type { HigherTimeframeBias } from "./bias.ts";
import { activeRoles, assertValidTimeframePolicy, baseTimeframe, DEFAULT_TIMEFRAME_POLICY, roleTimeframe } from "./hierarchy.ts";
import type { TimeframePolicy, TimeframeRole } from "./hierarchy.ts";
import { resampleSession } from "./resample.ts";
import { DEFAULT_TIMEFRAME_SYNC_POLICY, maxAgeFor } from "./sync.ts";
import type { TimeframeSyncPolicy } from "./sync.ts";

export interface RoleContext {
  role: TimeframeRole;
  timeframe: Timeframe;
  state: TechnicalState | null;
  direction: Direction;
  /** Close time of the last CLOSED candle used (higher TFs may lag lower TFs by design). */
  lastClosedAt: number | null;
  fresh: boolean;
  reasons: string[];
  blockers: BlockerCode[];
}

export interface MultiTimeframeState {
  symbol: string;
  /** Evaluation clock (explicit `now`). */
  timestamp: number;

  macro: TechnicalState | null;
  structure: TechnicalState | null;
  setup: TechnicalState | null;
  execution: TechnicalState | null;
  refinement?: TechnicalState | null;

  roles: RoleContext[];
  timeframes: TimeframePolicy;

  bias: HigherTimeframeBias;

  synchronized: boolean;

  reasons: string[];
  blockers: string[];
}

export interface MultiTimeframeInput {
  /** Base-timeframe sessions, ascending; the last one is the current (possibly in-progress) session. */
  sessions: readonly TradingSession[];
  now: number;
  policy?: TimeframePolicy;
  syncPolicy?: TimeframeSyncPolicy;
  dataQualityPolicy?: DataQualityPolicy;
}

/** Validate base sessions once: completed history + current session (sufficiency is checked per role). */
export function assessBaseSessions(sessions: readonly TradingSession[], timeframe: Timeframe, now: number, dq: DataQualityPolicy) {
  const current = sessions[sessions.length - 1];
  if (!current) return dataQualityFailure("NO_DATA", "no base sessions supplied");
  const history = sessions.slice(0, -1);
  const parts = [
    assessSessionQuality(current, { now, policy: dq, historyCandles: Number.MAX_SAFE_INTEGER }),
    ...assessSessionHistory(current, history, dq),
  ];
  if (sessions.some((s) => s.timeframe !== timeframe)) parts.push(dataQualityFailure("MIXED_SERIES", `base sessions must be ${timeframe}`));
  return mergeDataQuality(...parts);
}

function roleContext(role: TimeframeRole, timeframe: Timeframe, sessions: readonly TradingSession[], now: number, sync: TimeframeSyncPolicy, dq: DataQualityPolicy): RoleContext {
  const empty = (blockers: BlockerCode[], reasons: string[]): RoleContext => ({ role, timeframe, state: null, direction: "NEUTRAL", lastClosedAt: null, fresh: false, reasons, blockers });
  const derived = sessions.map((s) => resampleSession(s, timeframe, now));
  const failure = derived.find((d) => d.failure)?.failure;
  if (failure) return empty([...failure.blockers], failure.reasons.map((r) => `${role}: ${r}`));

  const candles = derived.flatMap((d) => d.session.candles);
  const ends = derived.flatMap((d) => d.bucketEnds);
  const required = effectiveMinimumCandles(dq);
  if (candles.length < required) return empty(["INSUFFICIENT_HISTORY"], [`${role} ${timeframe}: ${candles.length} closed candles, ${required} required`]);
  const malformed = candles.findIndex((c) => validateCandle(c).length > 0);
  if (malformed >= 0) return empty(["MALFORMED_OHLC"], [`${role} ${timeframe}: derived candle ${malformed} is malformed`]);

  const lastClosedAt = ends[ends.length - 1] as number;
  const age = now - lastClosedAt;
  const fresh = age <= maxAgeFor(role, sync);
  // VWAP: the most recent session that has a closed candle at this timeframe (as of its last closed candle).
  const vwapSession = [...derived].reverse().find((d) => d.session.candles.length > 0) as (typeof derived)[number];
  const built = assembleTechnicalState({ symbol: vwapSession.session.symbol, timeframe, candles, vwapBars: vwapSession.session.candles, volumeBars: candles });
  if (!built.ok) return empty(["BAD_DATA"], [`${role} ${timeframe}: ${built.reason}`]);
  return {
    role,
    timeframe,
    state: built.state,
    direction: classifyDirection(built.state),
    lastClosedAt,
    fresh,
    reasons: fresh ? [] : [`${role} ${timeframe} context is stale (${age}ms since last close)`],
    blockers: fresh ? [] : ["STALE_DATA"],
  };
}

/**
 * Deterministic multi-timeframe context for one symbol. Every role is DERIVED from the single base feed,
 * using closed candles only, so roles can never disagree about the underlying bars.
 */
export function buildMultiTimeframeState(input: MultiTimeframeInput): Readonly<MultiTimeframeState> {
  const policy = input.policy ?? DEFAULT_TIMEFRAME_POLICY;
  assertValidTimeframePolicy(policy);
  const sync = input.syncPolicy ?? DEFAULT_TIMEFRAME_SYNC_POLICY;
  const dq = input.dataQualityPolicy ?? DEFAULT_DATA_QUALITY_POLICY;
  const { sessions, now } = input;
  const symbol = sessions[sessions.length - 1]?.symbol ?? "";
  const roles = activeRoles(policy);

  const baseQuality = assessBaseSessions(sessions, baseTimeframe(policy), now, dq);
  const contexts: RoleContext[] = baseQuality.valid
    ? roles.map((r) => roleContext(r, roleTimeframe(policy, r) as Timeframe, sessions, now, sync, dq))
    : roles.map((r) => ({ role: r, timeframe: roleTimeframe(policy, r) as Timeframe, state: null, direction: "NEUTRAL" as const, lastClosedAt: null, fresh: false, reasons: [], blockers: [] }));
  const byRole = (r: TimeframeRole) => contexts.find((c) => c.role === r);
  const macro = byRole("MACRO") as RoleContext;
  const structure = byRole("STRUCTURE") as RoleContext;
  const refinement = byRole("REFINEMENT");

  const blockers = mergeUnique<string>(baseQuality.blockers, ...contexts.map((c) => c.blockers), contexts.some((c) => c.state === null) ? ["UNSYNCHRONIZED_TIMEFRAMES"] : []);
  const synchronized = blockers.length === 0;
  const bias = synchronized ? deriveHigherTimeframeBias(macro.direction, structure.direction) : "NEUTRAL";
  const reasons = synchronized
    ? [`Macro ${macro.direction}, structure ${structure.direction} => ${bias} bias`]
    : mergeUnique(["Multi-timeframe context is not synchronized"], baseQuality.reasons, ...contexts.map((c) => c.reasons));

  return deepFreeze({
    symbol,
    timestamp: now,
    macro: macro.state,
    structure: structure.state,
    setup: (byRole("SETUP") as RoleContext).state,
    execution: (byRole("EXECUTION") as RoleContext).state,
    ...(refinement ? { refinement: refinement.state } : {}),
    roles: contexts,
    timeframes: { ...policy },
    bias,
    synchronized,
    reasons,
    blockers,
  });
}

export function roleDirection(state: MultiTimeframeState, role: TimeframeRole): Direction {
  return state.roles.find((r) => r.role === role)?.direction ?? "NEUTRAL";
}
