import { validateCandle } from "../data-quality/candle-validation.ts";
import { deepFreeze } from "../domain/freeze.ts";
import type { Candle, Timeframe, TradingSession } from "../domain/types.ts";
import { TIMEFRAME_MS } from "../timeframe/timeframe.ts";
import type { SessionCalendar } from "./calendar.ts";
import type { FeedPlan } from "./symbol-map.ts";
import type { FeedRole, MarketDataProvenance, ProviderFailure, ProviderFailureCode, ProviderResult } from "./types.ts";
import { REQUIRED_FEED_ROLES } from "./types.ts";

/** PROVISIONAL normalization policy (descriptive defaults; never auto-tuned). */
export interface NormalizationPolicy {
  /** Max lag between the latest bar that should have closed and the latest delivered closed bar. */
  maxStalenessMs: number;
  /** Max disagreement between feeds' latest market timestamps (0 = same bar). */
  maxFeedSkewMs: number;
}

export const DEFAULT_NORMALIZATION_POLICY: Readonly<NormalizationPolicy> = Object.freeze({ maxStalenessMs: 60_000, maxFeedSkewMs: 0 });

export interface FeedInput {
  provider: string;
  plan: FeedPlan;
  timeframe: Timeframe;
  /** Provider responses in fetch order (e.g. history then latest). Any failure fails the feed. */
  results: readonly ProviderResult<Candle[]>[];
  calendar: SessionCalendar;
  /** Requested bar-open window [from, now]. */
  from: number;
  now: number;
  fetchedAt: number;
  policy?: NormalizationPolicy;
}

export type NormalizedFeed = { ok: true; role: FeedRole; sessions: TradingSession[]; provenance: MarketDataProvenance } | { ok: false; role: FeedRole; failure: ProviderFailure };

const fail = (input: FeedInput, code: ProviderFailureCode, message: string, retryAfterMs?: number): NormalizedFeed =>
  deepFreeze({
    ok: false as const,
    role: input.plan.role,
    failure: { code, message, role: input.plan.role, canonicalSymbol: input.plan.canonicalSymbol, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) },
  });

/**
 * Normalize one provider feed into canonical TradingSessions. Validates mapping, OHLC integrity, ordering,
 * duplicates, session boundaries/alignment, completeness and staleness. Fails closed; never fills gaps,
 * reorders, or interpolates. Only drops the still-forming bar (not yet closed at `now`).
 */
export function normalizeFeed(input: FeedInput): Readonly<NormalizedFeed> {
  const policy = input.policy ?? DEFAULT_NORMALIZATION_POLICY;
  const { plan, timeframe, calendar, now, from } = input;
  const tf = TIMEFRAME_MS[timeframe];
  const warnings: string[] = [];
  const bars: Candle[] = [];
  for (const r of input.results) {
    if (!r.ok) return fail(input, r.failure.code, r.failure.message, r.failure.retryAfterMs);
    if (r.providerSymbol !== plan.providerSymbol) return fail(input, "INVALID_SYMBOL_MAPPING", `provider answered for ${r.providerSymbol}, requested ${plan.providerSymbol}`);
    warnings.push(...r.warnings);
    bars.push(...r.value);
  }

  if (calendar.covers && (!calendar.covers(from) || !calendar.covers(now))) return fail(input, "SESSION_BOUNDARY", "requested window is outside the exchange calendar's verified coverage");
  const accepted: Candle[] = [];
  for (const [i, b] of bars.entries()) {
    if (b.symbol !== plan.providerSymbol) return fail(input, "INVALID_SYMBOL_MAPPING", `bar for ${String(b.symbol)} in the ${plan.providerSymbol} feed`);
    if (b.timeframe !== timeframe) return fail(input, "MALFORMED_BARS", `bar timeframe ${String(b.timeframe)}, expected ${timeframe}`);
    const issues = validateCandle(b);
    if (issues.length > 0) return fail(input, "MALFORMED_BARS", `invalid bar at ${String(b.timestamp)}: ${issues[0]?.message}`);
    const prev = bars[i - 1];
    if (prev && b.timestamp === prev.timestamp) return fail(input, "DUPLICATE_BARS", `duplicate bar at ${b.timestamp}`);
    if (prev && b.timestamp < prev.timestamp) return fail(input, "OUT_OF_ORDER", `bar ${b.timestamp} after ${prev.timestamp}`);
    if (b.timestamp > now) return fail(input, "FUTURE_BAR", `bar opens after the evaluation clock (${b.timestamp})`);
    const w = calendar.sessionAt(b.timestamp);
    if (!w) {
      const reason = calendar.excluded?.(b.timestamp);
      if (reason) {
        warnings.push(`bars in an excluded session dropped (${reason})`);
        continue;
      }
      return fail(input, "SESSION_BOUNDARY", `bar ${b.timestamp} is outside a regular session`);
    }
    if ((b.timestamp - w.openTimestamp) % tf !== 0) return fail(input, "SESSION_BOUNDARY", `bar ${b.timestamp} is off the ${timeframe} session grid`);
    if (b.timestamp < from) {
      warnings.push("bars before the requested window ignored");
      continue;
    }
    if (b.timestamp + tf > now) {
      if (i !== bars.length - 1) return fail(input, "OUT_OF_ORDER", "forming bar is not the latest bar");
      warnings.push("still-forming bar excluded");
      continue;
    }
    // Canonical fields only: vendor-specific extras (labels, signals, flags) never reach the engine.
    accepted.push({ symbol: plan.canonicalSymbol, timeframe, timestamp: b.timestamp, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume });
  }

  // Completeness: every bar that should have closed inside the window must be present.
  const expected: number[] = [];
  for (const w of calendar.sessionsBetween(from, now + 1)) {
    for (let t = Math.max(w.openTimestamp, from); t < w.closeTimestamp && t + tf <= now; t += tf) expected.push(t);
  }
  const have = new Set(accepted.map((b) => b.timestamp));
  const missing = expected.filter((t) => !have.has(t));
  if (accepted.length === 0) return fail(input, "MISSING_BARS", "provider returned no closed bars for the window");
  const latest = (accepted.at(-1) as Candle).timestamp;
  if (missing.length > 0) {
    const tailOnly = missing.every((t) => t > latest);
    const lag = (expected.at(-1) as number) - latest;
    if (!tailOnly) return fail(input, "MISSING_BARS", `${missing.filter((t) => t < latest).length} bar(s) missing inside the window`);
    if (lag > policy.maxStalenessMs) return fail(input, "STALE_DATA", `latest bar is ${Math.round(lag / 60_000)} min behind the market clock`);
    warnings.push("latest bar within staleness tolerance but behind the market clock");
  }

  const bySession = new Map<number, TradingSession>();
  for (const b of accepted) {
    const w = calendar.sessionAt(b.timestamp) as { openTimestamp: number; closeTimestamp: number };
    let s = bySession.get(w.openTimestamp);
    if (!s) {
      s = { sessionId: `${plan.canonicalSymbol}-${w.openTimestamp}`, symbol: plan.canonicalSymbol, timeframe, openTimestamp: w.openTimestamp, closeTimestamp: w.closeTimestamp, candles: [] };
      bySession.set(w.openTimestamp, s);
    }
    s.candles.push(b);
  }
  const sessions = [...bySession.values()];
  return deepFreeze({
    ok: true as const,
    role: plan.role,
    sessions,
    provenance: {
      provider: input.provider,
      providerSymbol: plan.providerSymbol,
      canonicalSymbol: plan.canonicalSymbol,
      role: plan.role,
      timeframe,
      fetchedAt: input.fetchedAt,
      latestMarketTimestamp: latest,
      evidenceMode: "DATA" as const,
      normalized: true,
      bars: accepted.length,
      sessions: sessions.length,
      warnings: [...new Set(warnings)],
    },
  });
}

export interface AssembledMarketData {
  target: TradingSession[];
  spx: TradingSession[];
  mnq: TradingSession[];
  volumeProxy?: TradingSession[];
}

export type AssemblyResult =
  | { ok: true; data: AssembledMarketData; provenance: MarketDataProvenance[]; latestMarketTimestamp: number; warnings: string[] }
  | { ok: false; failures: ProviderFailure[] };

/** Cross-feed checks: every required role present and all feeds on the same market clock. Proxy failures drop the proxy. */
export function assembleFeeds(feeds: readonly NormalizedFeed[], policy: NormalizationPolicy = DEFAULT_NORMALIZATION_POLICY): Readonly<AssemblyResult> {
  const failures: ProviderFailure[] = [];
  const warnings: string[] = [];
  const ok = new Map<FeedRole, Extract<NormalizedFeed, { ok: true }>>();
  for (const f of feeds) {
    if (f.ok) ok.set(f.role, f);
    else if (f.role === "VOLUME_PROXY") warnings.push(`volume proxy dropped: ${f.failure.message}`);
    else failures.push(f.failure);
  }
  for (const role of REQUIRED_FEED_ROLES) {
    if (!ok.has(role) && !failures.some((x) => x.role === role)) failures.push({ code: "PARTIAL_MARKET_CONTEXT", message: `${role} feed not provided`, role });
  }
  if (failures.length > 0) return deepFreeze({ ok: false as const, failures });
  const required = REQUIRED_FEED_ROLES.map((r) => ok.get(r) as Extract<NormalizedFeed, { ok: true }>);
  const latest = required.map((f) => f.provenance.latestMarketTimestamp);
  if (Math.max(...latest) - Math.min(...latest) > policy.maxFeedSkewMs) {
    return deepFreeze({
      ok: false as const,
      failures: [{ code: "TIMESTAMP_DISAGREEMENT" as const, message: `feeds disagree on the latest bar (${required.map((f) => `${f.role}=${f.provenance.latestMarketTimestamp}`).join(", ")})` }],
    });
  }
  const proxy = ok.get("VOLUME_PROXY");
  if (proxy && proxy.provenance.latestMarketTimestamp !== latest[0]) {
    warnings.push("volume proxy dropped: not on the same market clock");
  }
  const useProxy = proxy && proxy.provenance.latestMarketTimestamp === latest[0];
  const [target, spx, mnq] = required as [Extract<NormalizedFeed, { ok: true }>, Extract<NormalizedFeed, { ok: true }>, Extract<NormalizedFeed, { ok: true }>];
  return deepFreeze({
    ok: true as const,
    data: { target: [...target.sessions], spx: [...spx.sessions], mnq: [...mnq.sessions], ...(useProxy ? { volumeProxy: [...proxy.sessions] } : {}) },
    provenance: [...required, ...(useProxy ? [proxy] : [])].map((f) => f.provenance),
    latestMarketTimestamp: latest[0] as number,
    warnings,
  });
}

/** Provider failures never produce a setup: rate limiting / a closed market are transient (WAIT); everything else is BLOCKED. */
export function providerFailurePermission(failures: readonly ProviderFailure[]): "WAIT" | "BLOCKED" {
  return failures.length > 0 && failures.every((f) => f.code === "RATE_LIMITED" || f.code === "MARKET_CLOSED") ? "WAIT" : "BLOCKED";
}
