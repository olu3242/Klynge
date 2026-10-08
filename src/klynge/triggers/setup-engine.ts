import { mergeUnique } from "../domain/blockers.ts";
import { deepFreeze } from "../domain/freeze.ts";
import type { Candle, Direction, TradingSession } from "../domain/types.ts";
import { evaluateConfirmation } from "../confirmation/confirmation.ts";
import type { ConfirmationResult } from "../confirmation/confirmation.ts";
import { assessSessionQuality } from "../data-quality/series-quality.ts";
import { evaluateDirection } from "../engine/direction.ts";
import type { MarketTruthSnapshot } from "../engine/market-truth.ts";
import { buildTechnicalState } from "../engine/technical-state.ts";
import { provenance } from "../engine/version.ts";
import { atrSeries } from "../indicators/atr.ts";
import { relativeVolume } from "../indicators/volume.ts";
import { discoverLevels, isTradableBreakLevel } from "../levels/discover-levels.ts";
import { RESISTANCE_TYPES, SUPPORT_TYPES } from "../levels/types.ts";
import type { PriceLevel } from "../levels/types.ts";
import { DEFAULT_DATA_QUALITY_POLICY } from "../policies/data-quality-policy.ts";
import type { DataQualityPolicy } from "../policies/data-quality-policy.ts";
import { InvariantViolation, isDirectionallyEligible } from "../policies/invariants.ts";
import { evaluateTradePermission } from "../policies/trade-permission.ts";
import { runPriceAction } from "../price-action/state-machine.ts";
import type { PriceActionLifecycle, PriceActionResult, SetupSide } from "../price-action/types.ts";
import { evaluateRisk } from "../risk/risk-engine.ts";
import type { RiskState } from "../risk/risk-engine.ts";
import { findSwingPoints } from "../structure/swings.ts";
import { validateDecisionState } from "./invariants.ts";
import type { MultiTimeframeState } from "../timeframe/multi-timeframe.ts";
import { assertValidSetupPolicy, DEFAULT_MULTI_TIMEFRAME_SETUP_POLICY, DEFAULT_SETUP_POLICY, priceActionPolicyOf } from "./setup-policy.ts";
import type { DecisionMultiTimeframe, KlyngeDecision, KlyngeDecisionState, SetupIdentity, SetupPolicy, SetupProgress } from "./types.ts";

export interface SetupEvaluationInput {
  /** Canonical market-truth snapshot (evaluateMarketTruth) for the same `now`. */
  marketTruth: MarketTruthSnapshot;
  /** Target instrument, current session (closed candles). */
  target: TradingSession;
  /** Completed prior session for the target (prior-session levels). */
  priorSession?: TradingSession;
  /** Completed prior sessions for multi-session indicator warm-up of the target (levels stay session-scoped). */
  targetHistory?: readonly TradingSession[];
  now: number;
  policy?: SetupPolicy;
  dataQualityPolicy?: DataQualityPolicy;
  /** The previous decision for this symbol/timeframe — used only to end lifecycles, never to enable one. */
  previous?: KlyngeDecisionState;
  /**
   * Optional multi-timeframe context (buildMultiTimeframeState, same symbol, same `now`, SETUP role = target TF).
   * It can only gate (BLOCKED/INVALIDATED) or downgrade (CALL/PUT -> WAIT); it can never create a setup.
   */
  multiTimeframe?: MultiTimeframeState;
}

const fmt = (n: number) => n.toFixed(2);
const sideName = (side: SetupSide) => (side === "BULLISH" ? "CALL" : "PUT");
const STAGES: [keyof SetupProgress, string][] = [
  ["marketTruth", "Market permission"],
  ["targetDirection", "Target direction aligned with regime"],
  ["level", "Valid level"],
  ["break", "Break"],
  ["acceptance", "Acceptance"],
  ["retest", "Retest"],
  ["confirmation", "Continuation confirmation"],
  ["risk", "Risk approval"],
];
const NO_PROGRESS: SetupProgress = { marketTruth: false, targetDirection: false, level: false, break: false, acceptance: false, retest: false, confirmation: false, risk: false };

export function setupIdentity(target: Pick<TradingSession, "symbol" | "timeframe">, side: SetupSide, lc: Pick<PriceActionLifecycle, "levelId" | "startedAt">): SetupIdentity {
  const direction = sideName(side);
  return {
    setupId: `${target.symbol}:${target.timeframe}:${direction}:${lc.levelId}:${lc.startedAt}`,
    symbol: target.symbol,
    timeframe: target.timeframe,
    direction,
    levelId: lc.levelId,
    startedAt: lc.startedAt,
  };
}

/** A previous lifecycle that was still live (break had occurred and it had not ended). */
function activePrevious(prev: KlyngeDecisionState | undefined, target: TradingSession): SetupIdentity | undefined {
  if (!prev?.setup || prev.symbol !== target.symbol || prev.timeframe !== target.timeframe) return undefined;
  return prev.decision === "WAIT" || prev.decision === "CALL_SETUP" || prev.decision === "PUT_SETUP" ? prev.setup : undefined;
}

interface Draft {
  decision: KlyngeDecision;
  timestamp: number;
  targetDirection: Direction;
  progress: SetupProgress;
  reasons: string[];
  blockers: string[];
  invalidationReasons: string[];
  summary: string;
  invalidatesIf?: string[];
  extraMissing?: string[];
  level?: PriceLevel;
  lifecycle?: PriceActionLifecycle;
  priceActionState?: PriceActionResult["state"];
  confirmation?: ConfirmationResult;
  risk?: RiskState;
  setup?: SetupIdentity;
  multiTimeframe?: DecisionMultiTimeframe;
}

/**
 * Klynge Setup Engine. Pipeline:
 *   market truth gate -> target data quality -> target/regime alignment -> levels -> break -> acceptance
 *   -> retest -> confirmation -> risk -> decision.
 * Regime is permission to continue analysis, never a setup. Pure and deterministic; output deep-frozen.
 */
export function evaluateSetup(input: SetupEvaluationInput): Readonly<KlyngeDecisionState> {
  const policy = input.policy ?? DEFAULT_SETUP_POLICY;
  assertValidSetupPolicy(policy);
  const dqPolicy = input.dataQualityPolicy ?? DEFAULT_DATA_QUALITY_POLICY;
  const { marketTruth: mt, target, now } = input;
  const lastTs = target.candles.at(-1)?.timestamp ?? now;
  const prevActive = activePrevious(input.previous, target);
  let mtfSummary: DecisionMultiTimeframe | undefined;
  const prev = input.previous;
  const prevSameSeries = prev !== undefined && prev.symbol === target.symbol && prev.timeframe === target.timeframe;
  const prevInvalidatedId = prevSameSeries && prev.decision === "INVALIDATED" ? prev.setup?.setupId : undefined;

  const finish = (d: Draft): Readonly<KlyngeDecisionState> => {
    const state: KlyngeDecisionState = {
      evidenceMode: "DATA",
      symbol: target.symbol,
      timeframe: target.timeframe,
      timestamp: d.timestamp,
      decision: d.decision,
      regime: mt.regime.regime,
      marketAligned: mt.regime.aligned,
      targetDirection: d.targetDirection,
      ...(d.level ? { level: d.level } : {}),
      ...(d.priceActionState ? { priceActionState: d.priceActionState } : {}),
      ...(d.confirmation ? { confirmationState: d.confirmation.state } : {}),
      ...(d.confirmation?.quality ? { confirmationQuality: d.confirmation.quality } : {}),
      ...(d.risk ? { risk: d.risk } : {}),
      reasons: mergeUnique(d.reasons),
      blockers: mergeUnique(d.blockers),
      invalidationReasons: mergeUnique(d.invalidationReasons),
      progress: d.progress,
      ...(d.setup ? { setup: d.setup } : {}),
      transitions: d.lifecycle?.transitions ?? [],
      ...(mtfSummary ? { multiTimeframe: mtfSummary } : {}),
      explanation: {
        summary: d.summary,
        missing: d.decision === "INVALIDATED" ? [] : [...STAGES.filter(([k]) => !d.progress[k]).map(([, label]) => label), ...(d.extraMissing ?? [])],
        invalidatesIf: d.invalidatesIf ?? [],
        riskBlockers: d.risk && !d.risk.allowed ? d.risk.reasons : [],
      },
      provenance: provenance(now),
    };
    const violations = validateDecisionState(state, policy);
    if (violations.length) throw new InvariantViolation(`setup engine produced an inconsistent ${state.decision}: ${violations.join("; ")}`);
    return deepFreeze(state);
  };

  /** Loss of an upstream gate: an active lifecycle is INVALIDATED (never resumed); otherwise BLOCKED. */
  const gateLost = (blockers: string[], reasons: string[], invalidation: string, targetDirection: Direction = "NEUTRAL", progress: SetupProgress = NO_PROGRESS): Readonly<KlyngeDecisionState> =>
    prevActive
      ? finish({ decision: "INVALIDATED", timestamp: lastTs, targetDirection, progress, reasons, blockers, invalidationReasons: [invalidation], summary: invalidation, setup: prevActive })
      : finish({ decision: "BLOCKED", timestamp: lastTs, targetDirection, progress, reasons, blockers, invalidationReasons: [], summary: reasons[0] ?? "Blocked" });

  // 1. MARKET TRUTH GATE — consume the canonical permission and re-run the canonical policy on its inputs.
  const recomputed = evaluateTradePermission(mt.regime, mt.dataQuality);
  const clockMismatch = mt.provenance.evaluatedAt !== now;
  const requiredSide: SetupSide | null = mt.regime.regime === "RISK_ON" ? "BULLISH" : mt.regime.regime === "RISK_OFF" ? "BEARISH" : null;
  if (!isDirectionallyEligible(mt.permission) || !isDirectionallyEligible(recomputed) || clockMismatch || requiredSide === null) {
    const blockers = mergeUnique<string>(mt.permission.blockers, recomputed.blockers, clockMismatch ? ["INCONSISTENT_STATE"] : []);
    const reasons = ["Market permission is BLOCKED", ...mt.permission.reasons, ...(clockMismatch ? ["Market-truth snapshot was evaluated at a different time"] : [])];
    return gateLost(blockers.length ? blockers : ["UNKNOWN_REGIME"], reasons, "Market context changed against the active setup");
  }
  const marketProgress: SetupProgress = { ...NO_PROGRESS, marketTruth: true };

  // 2. TARGET DATA QUALITY + TECHNICAL STATE (validated before any analysis).
  const tech = buildTechnicalState(target, { now, policy: dqPolicy, ...(input.targetHistory ? { history: input.targetHistory } : {}) });
  if (!tech.ok) {
    return gateLost([...tech.dataQuality.blockers], ["Target data quality failed", ...tech.dataQuality.reasons], "Data quality failure halted the active setup", "NEUTRAL", marketProgress);
  }
  const marketTf = mt.technical.spx?.timeframe;
  if (marketTf !== target.timeframe) {
    return gateLost(["MULTI_TIMEFRAME_UNSUPPORTED"], [`Target timeframe ${target.timeframe} differs from market context timeframe ${String(marketTf)}`], "Market context no longer matches the setup timeframe", "NEUTRAL", marketProgress);
  }
  if (Math.abs(tech.state.timestamp - mt.regime.timestamp) > dqPolicy.maxMarketSnapshotSkewMs) {
    return gateLost(["TIMESTAMP_SKEW"], ["Target and market snapshots are out of sync"], "Data quality failure halted the active setup", "NEUTRAL", marketProgress);
  }
  const prior = input.priorSession;
  if (prior) {
    const pq = assessSessionQuality(prior, { now: prior.closeTimestamp, policy: dqPolicy });
    const priorBlockers = pq.blockers.filter((b) => b !== "INSUFFICIENT_HISTORY");
    if (prior.symbol !== target.symbol || prior.timeframe !== target.timeframe || prior.closeTimestamp > target.openTimestamp || prior.candles.length === 0 || priorBlockers.length > 0) {
      return gateLost(["PRIOR_SESSION_INVALID", ...priorBlockers], ["Prior session data is invalid for this target", ...pq.reasons], "Data quality failure halted the active setup", "NEUTRAL", marketProgress);
    }
  }

  // 3. TARGET DIRECTION ALIGNMENT.
  const targetDirection = evaluateDirection(tech.state).direction;
  const opposite: Direction = requiredSide === "BULLISH" ? "BEARISH" : "BULLISH";
  if (prevActive && prevActive.direction !== sideName(requiredSide)) {
    return gateLost([], [`Market regime is now ${mt.regime.regime}`], "Market regime changed against the active setup", targetDirection, marketProgress);
  }
  if (targetDirection === opposite) {
    return gateLost(["TARGET_REGIME_CONFLICT"], ["Target direction conflicts with market regime"], "Target direction turned against the active setup", targetDirection, marketProgress);
  }
  const targetAligned = targetDirection === requiredSide;

  // 3b. HIGHER-TIMEFRAME GATE (optional). Can only block / invalidate; never creates a setup.
  const mtf = input.multiTimeframe;
  const mtfPolicy = policy.multiTimeframe ?? DEFAULT_MULTI_TIMEFRAME_SETUP_POLICY;
  if (mtf) {
    const executionDirection = mtf.roles.find((r) => r.role === "EXECUTION")?.direction ?? "NEUTRAL";
    const biasApproved = mtf.bias === requiredSide || (mtf.bias === "NEUTRAL" && mtfPolicy.allowNeutralBias);
    mtfSummary = {
      bias: mtf.bias,
      synchronized: mtf.synchronized,
      biasApproved,
      executionDirection,
      executionConfirmed: mtfPolicy.requireExecutionConfirmation ? executionDirection === requiredSide : executionDirection !== opposite,
    };
    if (mtf.symbol !== target.symbol || mtf.timeframes.setup !== target.timeframe || mtf.timestamp !== now) {
      return gateLost(["INCONSISTENT_STATE"], ["Multi-timeframe context does not match this target, timeframe or clock"], "Multi-timeframe context changed against the active setup", targetDirection, marketProgress);
    }
    if (!mtf.synchronized) {
      return gateLost(["UNSYNCHRONIZED_TIMEFRAMES", ...mtf.blockers], ["Multi-timeframe context is not synchronized", ...mtf.reasons], "Data quality failure halted the active setup", targetDirection, marketProgress);
    }
    if (mtf.bias === "CONFLICTED" || mtf.bias === opposite) {
      const why = mtf.bias === "CONFLICTED" ? "Higher-timeframe context is conflicted" : "Higher-timeframe bias conflicts with the setup direction";
      return gateLost(["HTF_CONFLICT"], [why], "Higher-timeframe bias turned against the active setup", targetDirection, marketProgress);
    }
    if (!biasApproved) {
      return gateLost(["HTF_NOT_APPROVED"], ["Neutral higher-timeframe bias is not approved by policy"], "Higher-timeframe bias no longer supports the active setup", targetDirection, marketProgress);
    }
  }

  // 4. LEVELS (as-of each candle — no lookahead) + PRICE ACTION.
  const candles = target.candles;
  const n = candles.length;
  const swings = findSwingPoints(candles, policy.swingLookback);
  const historyCandles = (input.targetHistory ?? []).flatMap((h) => h.candles);
  const atrs = atrSeries([...historyCandles, ...candles]).slice(historyCandles.length);
  const breakTypes = requiredSide === "BULLISH" ? RESISTANCE_TYPES : SUPPORT_TYPES;
  const levelCtx = {
    session: target,
    policy: policy.levels,
    swingLookback: policy.swingLookback,
    swings,
    ...(prior ? { priorSession: prior } : {}),
    ...(historyCandles.length > 0 ? { atrAt: atrs } : {}),
  };
  const candidates = new Map<string, { level: PriceLevel; present: Set<number> }>();
  for (let i = 0; i < n; i++) {
    for (const level of discoverLevels({ ...levelCtx, asOfIndex: i - 1 })) {
      if (!isTradableBreakLevel(level, breakTypes)) continue;
      const entry = candidates.get(level.id) ?? { level, present: new Set<number>() };
      entry.present.add(i);
      candidates.set(level.id, entry);
    }
  }
  const currentLevels = discoverLevels({ ...levelCtx, asOfIndex: n - 1 });
  const paPolicy = priceActionPolicyOf(policy);
  const runs = [...candidates.keys()].sort().map((id) => {
    const { level, present } = candidates.get(id) as { level: PriceLevel; present: Set<number> };
    return { level, result: runPriceAction({ candles, level, side: requiredSide, startIndex: Math.min(...present), atrAt: atrs, policy: paPolicy, canStartLifecycle: (i) => present.has(i) }) };
  });
  const d = requiredSide === "BULLISH" ? 1 : -1;
  const withLifecycle = runs
    .filter((r) => r.result.lifecycles.length > 0)
    .map((r) => ({ ...r, lc: r.result.lifecycles.at(-1) as PriceActionLifecycle }))
    .sort((a, b) => b.lc.startedAt - a.lc.startedAt || d * (b.level.price - a.level.price) || (a.level.id < b.level.id ? -1 : 1));
  const chosen = withLifecycle[0];
  const close = (candles[n - 1] as Candle).close;
  const atrNow = tech.state.atr14;

  const baseInvalidates = [`Market regime leaves ${mt.regime.regime}`, `Target direction turns ${opposite}`];

  // 4a. No lifecycle yet: watch the nearest tradable level beyond price.
  if (!chosen) {
    const watch = currentLevels
      .filter((l) => isTradableBreakLevel(l, breakTypes) && d * (l.price - close) > 0)
      .sort((a, b) => d * (a.price - b.price) || (a.id < b.id ? -1 : 1))[0];
    const watchState = watch ? (runs.find((r) => r.level.id === watch.id)?.result.state ?? "WAITING") : undefined;
    const progress: SetupProgress = { ...marketProgress, targetDirection: targetAligned, level: watch !== undefined };
    return finish({
      decision: "WAIT",
      timestamp: tech.state.timestamp,
      targetDirection,
      progress,
      reasons: [
        watch ? `Watching ${watch.type} ${fmt(watch.price)}: ${watchState === "TESTING" ? "price is testing the level" : "no level test yet"}` : "No valid level beyond current price",
        ...(targetAligned ? [] : ["Target direction is not yet aligned with the market regime"]),
      ],
      blockers: [],
      invalidationReasons: [],
      summary: watch ? "Break pending." : "Waiting for a valid level to form.",
      invalidatesIf: baseInvalidates,
      ...(watch ? { level: watch } : {}),
      ...(watchState ? { priceActionState: watchState } : {}),
      confirmation: evaluateConfirmation({ marketPermissionEnabled: true, targetAligned, levelValid: watch !== undefined }),
    });
  }

  // 4b. Lifecycle exists.
  const { level, lc } = chosen;
  const setup = setupIdentity(target, requiredSide, lc);
  const progress: SetupProgress = {
    ...marketProgress,
    targetDirection: targetAligned,
    level: true,
    break: true,
    acceptance: lc.acceptedAt !== undefined,
    retest: lc.retestStartedAt !== undefined,
    confirmation: false,
    risk: false,
  };
  const common = { timestamp: tech.state.timestamp, targetDirection, level, lifecycle: lc, priceActionState: lc.state, setup };

  if (lc.state === "FAILED" || lc.state === "INVALIDATED") {
    const why = lc.endReason ?? "Setup failed structurally.";
    return finish({ ...common, decision: "INVALIDATED", progress, reasons: [why], blockers: [], invalidationReasons: [why], summary: why, confirmation: evaluateConfirmation({ marketPermissionEnabled: true, targetAligned, levelValid: true, lifecycle: lc }) });
  }
  if (prevInvalidatedId === setup.setupId) {
    const why = "This lifecycle was already invalidated; a new lifecycle is required.";
    return finish({ ...common, decision: "INVALIDATED", progress, reasons: [why], blockers: [], invalidationReasons: [why], summary: why });
  }

  const failLevel = level.price - d * policy.acceptance.maximumFailureDistanceAtr * atrNow;
  const invalidatesIf = [
    lc.invalidation !== undefined ? `Close beyond structural invalidation ${fmt(lc.invalidation)}` : `Close materially back through ${fmt(level.price)} (beyond ${fmt(failLevel)})`,
    ...baseInvalidates,
  ];
  const contRatio = lc.continuationIndex !== undefined ? (relativeVolume(candles.slice(0, lc.continuationIndex + 1))?.ratio ?? null) : null;
  const confirmation = evaluateConfirmation({ marketPermissionEnabled: true, targetAligned, levelValid: true, lifecycle: lc, continuationVolumeRatio: contRatio });

  if (confirmation.state !== "CONFIRMED") {
    const stage =
      lc.state === "BROKEN" ? ["Level broken; acceptance pending.", "Acceptance closes"]
      : lc.state === "ACCEPTED" ? ["Break has been accepted; retest pending.", "Valid retest and continuation confirmation"]
      : lc.state === "RETESTING" ? ["Retest in progress; continuation confirmation pending.", "Continuation close"]
      : ["Sequence confirmed; waiting for target direction to align.", "Target direction alignment"];
    return finish({ ...common, decision: "WAIT", progress, reasons: [stage[0] as string, `Missing: ${stage[1] as string}`], blockers: [], invalidationReasons: [], summary: stage[0] as string, invalidatesIf, confirmation });
  }

  // 5. RISK — a confirmed setup can still be blocked.
  const brokenLevelIds = new Set(
    currentLevels
      .filter((l) => candles.some((c) => c.timestamp > (l.confirmedAt ?? l.createdAt) && d * (c.close - l.price) > 0))
      .map((l) => l.id),
  );
  const risk = evaluateRisk({
    side: requiredSide,
    level,
    ...(lc.invalidation !== undefined ? { invalidation: lc.invalidation } : {}),
    levels: currentLevels,
    brokenLevelIds,
    currentPrice: tech.state.price,
    atr14: atrNow,
    policy: policy.risk,
  });
  const confirmedProgress = { ...progress, confirmation: true, risk: risk.allowed };
  if (!risk.allowed) {
    return finish({ ...common, decision: "BLOCKED", progress: confirmedProgress, reasons: ["Setup confirmed but risk is not permitted", ...risk.reasons], blockers: [...risk.blockers], invalidationReasons: [], summary: risk.reasons[0] ?? "Risk rejected", invalidatesIf, confirmation, risk });
  }
  // 6. EXECUTION CONTEXT (optional): may only downgrade a directional decision to WAIT.
  if (mtfSummary && !mtfSummary.executionConfirmed) {
    const why = mtfSummary.executionDirection === opposite ? "Execution timeframe opposes the setup; execution timing pending." : "Execution timeframe confirmation pending.";
    return finish({ ...common, decision: "WAIT", progress: confirmedProgress, reasons: [why], blockers: [], invalidationReasons: [], summary: why, invalidatesIf, extraMissing: ["Execution timeframe confirmation"], confirmation, risk });
  }
  const decision: KlyngeDecision = requiredSide === "BULLISH" ? "CALL_SETUP" : "PUT_SETUP";
  return finish({
    ...common,
    decision,
    progress: confirmedProgress,
    reasons: [`All ${decision === "CALL_SETUP" ? "bullish" : "bearish"} conditions met (${confirmation.quality ?? "STANDARD"} quality). This is not a recommendation.`],
    blockers: [],
    invalidationReasons: [],
    summary: "Conditions met.",
    invalidatesIf,
    confirmation,
    risk,
  });
}
