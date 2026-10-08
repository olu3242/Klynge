import { detectDataVerified, detectDecisionChange, detectRegimeChange, providerFailureAlert } from "../alerts/state-change.ts";
import type { StateAlert } from "../alerts/state-change.ts";
import { deepFreeze } from "../domain/freeze.ts";
import type { TradingSession } from "../domain/types.ts";
import { evaluateOptions } from "../options/eligibility.ts";
import type { OptionChainSnapshot, OptionsDecision, OptionsDecisionState } from "../options/types.ts";
import { DEFAULT_MARKET_CONTEXT_POLICY } from "../policies/market-context-policy.ts";
import type { MarketContextPolicy } from "../policies/market-context-policy.ts";
import type { SessionCalendar } from "../providers/calendar.ts";
import { assembleFeeds, normalizeFeed, providerFailurePermission } from "../providers/normalize.ts";
import type { NormalizationPolicy } from "../providers/normalize.ts";
import { planFeeds } from "../providers/symbol-map.ts";
import type { SymbolMap } from "../providers/symbol-map.ts";
import type { FeedRole, LiveMarketDataProvider, MarketDataProvenance, MarketDataProvider, ProviderEvent, ProviderFailure, SubscriptionHandle } from "../providers/types.ts";
import type { DataHandoff } from "../snapshot/handoff.ts";
import { buildDataSnapshot, evaluateSnapshot } from "../snapshot/snapshot.ts";
import { baseTimeframe } from "../timeframe/hierarchy.ts";
import type { TimeframePolicy } from "../timeframe/hierarchy.ts";
import type { KlyngeDecision, KlyngeDecisionState } from "../triggers/types.ts";
import { KLYNGE_RULE_VERSION } from "../engine/version.ts";
import { fnv1a } from "./hash.ts";

export interface RuntimeConfig {
  /** Stable id of this DATA lineage (tenant-scoped by the store). */
  runtimeId: string;
  sessionId: string;
  /** Canonical target symbol (e.g. from a visual handoff hint, validated by the symbol map). */
  targetSymbol: string;
  timeframePolicy: TimeframePolicy;
  /** Prior sessions fetched for warm-up (current session is added). */
  historySessions: number;
  calendar: SessionCalendar;
  symbolMap: SymbolMap;
  contextPolicy?: MarketContextPolicy;
  includeVolumeProxy?: boolean;
  normalizationPolicy?: NormalizationPolicy;
}

/** Durable cursor that makes the runtime resumable and idempotent. */
export interface RuntimeState {
  runtimeId: string;
  targetSymbol: string;
  lastMarketTimestamp: number;
  /** Content hash of the last processed market state (idempotency key). */
  lastMarketKey: string;
  lastRecordId: string;
  lastDecision: KlyngeDecision;
  lastOptionsDecision: OptionsDecision | null;
  lastEventId: string | null;
  updatedAt: number;
  ruleVersion: string;
}

export interface RuntimeDecisionRecord {
  recordId: string;
  sessionId: string;
  symbol: string;
  timeframe: string;
  /** Open time of the latest verified bar this decision was evaluated on. */
  marketTimestamp: number;
  evaluatedAt: number;
  decision: KlyngeDecisionState;
  options: OptionsDecisionState | null;
  marketData: MarketDataProvenance[];
  handoff?: DataHandoff;
}

/** The latest persisted DATA decision for a symbol (runtime- or import-produced). */
export interface PreviousDecision {
  recordId: string;
  marketTimestamp: number;
  decision: KlyngeDecisionState;
}

/** Tenant-scoped persistence. Implementations derive ownership server-side; any throw ⇒ RUNTIME_STATE_UNAVAILABLE. */
export interface RuntimeStore {
  loadState(runtimeId: string): Promise<RuntimeState | null>;
  saveState(state: RuntimeState): Promise<void>;
  latestDecision(symbol: string): Promise<PreviousDecision | null>;
  getDecision(recordId: string): Promise<PreviousDecision | null>;
  putDecision(record: RuntimeDecisionRecord): Promise<boolean>;
  putAlert(alert: StateAlert): Promise<boolean>;
}

export interface OptionChainSource {
  getChain(canonicalSymbol: string, now: number): Promise<OptionChainSnapshot | null>;
}

export interface RuntimeDeps {
  provider: MarketDataProvider;
  store: RuntimeStore;
  optionChains?: OptionChainSource;
}

export type CycleOutcome =
  | {
      kind: "EVALUATED";
      recordId: string;
      created: boolean;
      decision: KlyngeDecisionState;
      options: OptionsDecisionState;
      alerts: StateAlert[];
      marketData: MarketDataProvenance[];
      marketTimestamp: number;
      previousRestored: boolean;
      warnings: string[];
    }
  | { kind: "UNCHANGED"; reason: "NO_NEW_MARKET_DATA" | "DUPLICATE_EVENT"; marketTimestamp: number; recordId: string; decision: KlyngeDecisionState }
  | { kind: "PROVIDER_FAILURE"; permission: "WAIT" | "BLOCKED"; failures: ProviderFailure[]; alerts: StateAlert[]; previous: KlyngeDecisionState | null }
  | { kind: "RUNTIME_STATE_UNAVAILABLE"; permission: "BLOCKED"; blocker: "RUNTIME_STATE_UNAVAILABLE"; reason: string };

const unavailable = (reason: string): Readonly<CycleOutcome> => deepFreeze({ kind: "RUNTIME_STATE_UNAVAILABLE" as const, permission: "BLOCKED" as const, blocker: "RUNTIME_STATE_UNAVAILABLE" as const, reason });

/** Options transitions worth surfacing. Options never create or alter the underlying decision. */
export function detectOptionsChange(prev: OptionsDecision | null, next: OptionsDecisionState, at: number): StateAlert | null {
  if (prev === next.decision) return null;
  const directional = next.underlyingDecision === "CALL_SETUP" || next.underlyingDecision === "PUT_SETUP";
  if (next.decision === "ELIGIBLE") {
    return { alertId: `${next.underlying}:DATA:OPTIONS:${prev ?? "NONE"}->ELIGIBLE:${at}`, event: "OPTIONS_ELIGIBLE", symbol: next.underlying, evidenceMode: "DATA", from: prev, to: "ELIGIBLE", at, severity: "ATTENTION", message: `${next.underlying}: option contracts meet the liquidity policy for the underlying ${next.underlyingDecision}. Not a recommendation.` };
  }
  if (prev === "ELIGIBLE" || directional) {
    return { alertId: `${next.underlying}:DATA:OPTIONS:${prev ?? "NONE"}->${next.decision}:${at}`, event: "OPTIONS_BLOCKED", symbol: next.underlying, evidenceMode: "DATA", from: prev, to: next.decision, at, severity: prev === "ELIGIBLE" ? "WARNING" : "INFO", message: `${next.underlying}: no option contract is eligible (${next.reasons[0] ?? next.decision}). The underlying decision is unchanged.` };
  }
  return null;
}

function marketStateKey(data: Record<string, readonly TradingSession[] | undefined>): string {
  function* parts() {
    for (const role of Object.keys(data).sort()) {
      yield role;
      for (const s of data[role] ?? []) for (const c of s.candles) yield `${c.symbol}|${c.timestamp}|${c.open}|${c.high}|${c.low}|${c.close}|${c.volume}`;
    }
  }
  return fnv1a(parts());
}

/**
 * One deterministic DATA cycle: restore → fetch → normalize → validate → market truth → MTF → setup → risk →
 * options → persist → compare previous → alert. The previous persisted decision is loaded automatically.
 * Reprocessing the same market state is a no-op. Untrusted durable state BLOCKS; it is never reconstructed.
 */
export async function runDataCycle(deps: RuntimeDeps, config: RuntimeConfig, now: number, opts: { handoff?: DataHandoff; eventId?: string } = {}): Promise<Readonly<CycleOutcome>> {
  const { store, provider } = deps;
  const target = config.targetSymbol;

  // 1. Restore durable state (fail closed).
  let state: RuntimeState | null;
  let prior: PreviousDecision | null;
  let restored: PreviousDecision | null = null;
  try {
    state = await store.loadState(config.runtimeId);
    if (state) {
      if (state.targetSymbol !== target) return unavailable(`runtime ${config.runtimeId} belongs to ${state.targetSymbol}, not ${target}`);
      restored = await store.getDecision(state.lastRecordId);
      if (!restored) return unavailable("persisted runtime state references a decision that cannot be loaded");
      if (restored.marketTimestamp !== state.lastMarketTimestamp) return unavailable("persisted runtime cursor disagrees with its decision record");
    }
    prior = await store.latestDecision(target);
  } catch {
    return unavailable("durable runtime state could not be loaded");
  }
  if (state && opts.eventId && state.lastEventId === opts.eventId && restored) {
    return deepFreeze({ kind: "UNCHANGED" as const, reason: "DUPLICATE_EVENT" as const, marketTimestamp: state.lastMarketTimestamp, recordId: state.lastRecordId, decision: restored.decision });
  }
  const lastProcessed = state?.lastMarketTimestamp ?? null;
  const failureAlert = async (failures: ProviderFailure[]): Promise<Readonly<CycleOutcome>> => {
    const permission = providerFailurePermission(failures);
    const alert = providerFailureAlert(target, failures, permission, lastProcessed ?? prior?.marketTimestamp ?? null, now);
    await store.putAlert(alert).catch(() => false);
    return deepFreeze({ kind: "PROVIDER_FAILURE" as const, permission, failures, alerts: [alert], previous: prior?.decision ?? null });
  };

  // 2. Plan feeds through the mapping layer.
  const ctx = config.contextPolicy ?? DEFAULT_MARKET_CONTEXT_POLICY;
  const roles: { role: FeedRole; canonicalSymbol: string }[] = [
    { role: "TARGET", canonicalSymbol: target },
    { role: "SPX", canonicalSymbol: ctx.broadMarketSymbol },
    { role: "MNQ", canonicalSymbol: ctx.technologyConfirmationSymbol },
  ];
  if (config.includeVolumeProxy && ctx.volumeProxySymbol) roles.push({ role: "VOLUME_PROXY", canonicalSymbol: ctx.volumeProxySymbol });
  const { plans, unmapped } = planFeeds(config.symbolMap, roles);
  const required = unmapped.filter((u) => u.role !== "VOLUME_PROXY");
  if (required.length > 0) {
    return failureAlert(required.map((u) => ({ code: "INVALID_SYMBOL_MAPPING" as const, message: `${u.canonicalSymbol} has no ${config.symbolMap.provider} symbol`, role: u.role, canonicalSymbol: u.canonicalSymbol })));
  }

  // 3. Fetch + normalize (history sessions + current session).
  const windows = config.calendar.recentSessions(now, config.historySessions + 1);
  const current = windows.at(-1);
  if (!current || windows.length < config.historySessions + 1) {
    return failureAlert([{ code: "MISSING_BARS", message: "not enough regular sessions in the calendar for warm-up" }]);
  }
  const from = (windows[0] as { openTimestamp: number }).openTimestamp;
  const timeframe = baseTimeframe(config.timeframePolicy);
  const feeds = await Promise.all(
    plans.map(async (plan) => {
      let results;
      try {
        const history = from < current.openTimestamp
          ? await provider.getHistoricalCandles({ canonicalSymbol: plan.canonicalSymbol, providerSymbol: plan.providerSymbol, timeframe, from, to: current.openTimestamp })
          : null;
        const latest = await provider.getLatestCandles({ canonicalSymbol: plan.canonicalSymbol, providerSymbol: plan.providerSymbol, timeframe, since: current.openTimestamp, now });
        results = history ? [history, latest] : [latest];
      } catch {
        results = [{ ok: false as const, failure: { code: "PROVIDER_UNAVAILABLE" as const, message: "provider request failed" } }];
      }
      return normalizeFeed({ provider: provider.id, plan, timeframe, results, calendar: config.calendar, from, now, fetchedAt: now, ...(config.normalizationPolicy ? { policy: config.normalizationPolicy } : {}) });
    }),
  );
  const assembled = assembleFeeds(feeds, config.normalizationPolicy);
  if (!assembled.ok) return failureAlert([...assembled.failures]);

  // 4. Idempotency + ordering against the durable cursor.
  const latest = assembled.latestMarketTimestamp;
  if (lastProcessed !== null && latest < lastProcessed) {
    return failureAlert([{ code: "OUT_OF_ORDER", message: "provider returned market data older than the last processed bar" }]);
  }
  const marketKey = marketStateKey(assembled.data as unknown as Record<string, readonly TradingSession[]>);
  const recordId = `${config.sessionId}:DATA:${target}:${latest}:${marketKey}`;
  if (state && restored && state.lastMarketKey === marketKey && state.lastRecordId === recordId) {
    return deepFreeze({ kind: "UNCHANGED" as const, reason: "NO_NEW_MARKET_DATA" as const, marketTimestamp: latest, recordId: state.lastRecordId, decision: restored.decision });
  }

  // 5. Deterministic engine (DATA mode only, from verified normalized data — never from visual values).
  const snapshot = buildDataSnapshot(config.sessionId, { ...assembled.data, timeframePolicy: config.timeframePolicy, ...(config.contextPolicy ? { contextPolicy: config.contextPolicy } : {}) }, now, { snapshotId: recordId, marketData: assembled.provenance });
  // Lifecycle memory: the latest persisted decision for this symbol is restored automatically (callers never pass it).
  const previous = prior && prior.recordId !== recordId && prior.marketTimestamp <= latest ? prior.decision : undefined;
  const evaluation = evaluateSnapshot(snapshot, { now, ...(previous ? { previous } : {}) });
  if (evaluation.evidenceMode !== "DATA") throw new Error("unreachable: runtime snapshots are DATA");
  const decision = evaluation.result.setup;

  // 6. Options — strictly downstream; a missing chain only means nothing is eligible.
  const lastClose = assembled.data.target.at(-1)?.candles.at(-1)?.close ?? Number.NaN;
  let chain: OptionChainSnapshot | null = null;
  if (deps.optionChains && (decision.decision === "CALL_SETUP" || decision.decision === "PUT_SETUP")) chain = await deps.optionChains.getChain(target, now).catch(() => null);
  const options = evaluateOptions({ setup: decision, chain: chain ?? { underlying: target, timestamp: now, contracts: [] }, now, underlyingPrice: lastClose });

  // 7. Persist, compare, alert, advance the cursor.
  const record: RuntimeDecisionRecord = {
    recordId,
    sessionId: config.sessionId,
    symbol: target,
    timeframe: decision.timeframe,
    marketTimestamp: latest,
    evaluatedAt: now,
    decision,
    options,
    marketData: [...assembled.provenance],
    ...(opts.handoff ? { handoff: opts.handoff } : {}),
  };
  let created: boolean;
  const alerts: StateAlert[] = [];
  try {
    created = await store.putDecision(record);
    for (const a of [detectDataVerified(previous, decision), detectRegimeChange(previous, decision), detectDecisionChange(previous, decision), detectOptionsChange(state?.lastOptionsDecision ?? null, options, now)]) {
      if (a && (await store.putAlert(a))) alerts.push(a);
    }
    await store.saveState({
      runtimeId: config.runtimeId,
      targetSymbol: target,
      lastMarketTimestamp: latest,
      lastMarketKey: marketKey,
      lastRecordId: recordId,
      lastDecision: decision.decision,
      lastOptionsDecision: options.decision,
      lastEventId: opts.eventId ?? state?.lastEventId ?? null,
      updatedAt: now,
      ruleVersion: KLYNGE_RULE_VERSION,
    });
  } catch {
    return unavailable("durable runtime state could not be written");
  }
  return deepFreeze({ kind: "EVALUATED" as const, recordId, created, decision, options, alerts, marketData: [...assembled.provenance], marketTimestamp: latest, previousRestored: Boolean(previous), warnings: [...assembled.warnings] });
}

/**
 * Live mode: subscribes to a streaming/polling source and runs one serialized cycle per new event. Events are only
 * re-evaluation triggers — bars are always re-read and normalized through the provider. Duplicate event ids are
 * ignored (in memory and via the durable cursor).
 */
export class LiveDataRuntime {
  private readonly deps: RuntimeDeps & { live: LiveMarketDataProvider };
  private readonly config: RuntimeConfig;
  private handle: SubscriptionHandle | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly seen = new Set<string>();
  readonly outcomes: Readonly<CycleOutcome>[] = [];

  constructor(deps: RuntimeDeps & { live: LiveMarketDataProvider }, config: RuntimeConfig) {
    this.deps = deps;
    this.config = config;
  }

  async start(): Promise<void> {
    const ctx = this.config.contextPolicy ?? DEFAULT_MARKET_CONTEXT_POLICY;
    const { plans } = planFeeds(this.config.symbolMap, [
      { role: "TARGET", canonicalSymbol: this.config.targetSymbol },
      { role: "SPX", canonicalSymbol: ctx.broadMarketSymbol },
      { role: "MNQ", canonicalSymbol: ctx.technologyConfirmationSymbol },
    ]);
    this.handle = await this.deps.live.subscribe({ symbols: plans.map((p) => ({ canonicalSymbol: p.canonicalSymbol, providerSymbol: p.providerSymbol })), timeframe: baseTimeframe(this.config.timeframePolicy) }, (e) => this.onEvent(e));
  }

  private onEvent(e: ProviderEvent): void {
    if (this.seen.has(e.eventId)) return;
    this.seen.add(e.eventId);
    this.queue = this.queue.then(async () => {
      const outcome =
        e.kind === "FAILURE"
          ? await this.failure(e.failure, e.receivedAt)
          : await runDataCycle(this.deps, this.config, e.receivedAt, { eventId: e.eventId });
      this.outcomes.push(outcome);
    });
  }

  private async failure(f: ProviderFailure, at: number): Promise<Readonly<CycleOutcome>> {
    let last: number | null = null;
    try {
      last = (await this.deps.store.loadState(this.config.runtimeId))?.lastMarketTimestamp ?? null;
    } catch {
      return unavailable("durable runtime state could not be loaded");
    }
    const permission = providerFailurePermission([f]);
    const alert = providerFailureAlert(this.config.targetSymbol, [f], permission, last, at);
    await this.deps.store.putAlert(alert).catch(() => false);
    return deepFreeze({ kind: "PROVIDER_FAILURE" as const, permission, failures: [f], alerts: [alert], previous: null });
  }

  /** Resolves once every queued event has been processed. */
  async drain(): Promise<void> {
    await this.queue;
  }

  async stop(): Promise<void> {
    await this.drain();
    await this.handle?.close();
    this.handle = null;
  }
}

/** In-memory RuntimeStore (tests, fixtures). Durable adapters live in the app. */
export class MemoryRuntimeStore implements RuntimeStore {
  readonly states = new Map<string, RuntimeState>();
  readonly decisions = new Map<string, RuntimeDecisionRecord>();
  readonly alerts = new Map<string, StateAlert>();
  failing = false;
  private check() {
    if (this.failing) throw new Error("store unavailable");
  }
  async loadState(id: string) {
    this.check();
    return this.states.get(id) ?? null;
  }
  async saveState(s: RuntimeState) {
    this.check();
    this.states.set(s.runtimeId, s);
  }
  async latestDecision(symbol: string) {
    this.check();
    const list = [...this.decisions.values()].filter((d) => d.symbol === symbol).sort((a, b) => a.marketTimestamp - b.marketTimestamp);
    const d = list.at(-1);
    return d ? { recordId: d.recordId, marketTimestamp: d.marketTimestamp, decision: d.decision } : null;
  }
  async getDecision(id: string) {
    this.check();
    const d = this.decisions.get(id);
    return d ? { recordId: d.recordId, marketTimestamp: d.marketTimestamp, decision: d.decision } : null;
  }
  async putDecision(r: RuntimeDecisionRecord) {
    this.check();
    if (this.decisions.has(r.recordId)) return false;
    this.decisions.set(r.recordId, r);
    return true;
  }
  async putAlert(a: StateAlert) {
    this.check();
    if (this.alerts.has(a.alertId)) return false;
    this.alerts.set(a.alertId, a);
    return true;
  }
}
