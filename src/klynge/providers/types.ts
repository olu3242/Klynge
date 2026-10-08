/**
 * Vendor-neutral market-data provider contracts. Adapters fetch and map symbols; they never classify market
 * direction. Everything they return is untrusted until `normalizeFeed` and the engine's data-quality layer accept it.
 */
import type { Candle, Timeframe } from "../domain/types.ts";

/** Canonical feed roles a Klynge DATA session needs (TARGET + SPX + MNQ required; VOLUME_PROXY optional). */
export type FeedRole = "TARGET" | "SPX" | "MNQ" | "VOLUME_PROXY";
export const REQUIRED_FEED_ROLES: readonly FeedRole[] = Object.freeze(["TARGET", "SPX", "MNQ"]);

export type ProviderFailureCode =
  | "PROVIDER_UNAVAILABLE"
  | "RATE_LIMITED"
  | "STALE_DATA"
  | "MISSING_BARS"
  | "OUT_OF_ORDER"
  | "DUPLICATE_BARS"
  | "MALFORMED_BARS"
  | "FUTURE_BAR"
  | "SESSION_BOUNDARY"
  | "INVALID_SYMBOL_MAPPING"
  | "TIMESTAMP_DISAGREEMENT"
  | "PARTIAL_MARKET_CONTEXT"
  | "ENTITLEMENT_MISSING"
  | "MARKET_CLOSED";

export interface ProviderFailure {
  code: ProviderFailureCode;
  message: string;
  role?: FeedRole;
  canonicalSymbol?: string;
  retryAfterMs?: number;
}

export type ProviderResult<T> =
  | { ok: true; value: T; providerSymbol: string; fetchedAt: number; warnings: string[]; /** Raw vendor payload(s) as received (historical ingestion keeps them separately). */ raw?: unknown[] }
  | { ok: false; failure: ProviderFailure };

export interface HistoricalRequest {
  canonicalSymbol: string;
  /** Resolved by the mapping layer — adapters never invent symbols. */
  providerSymbol: string;
  timeframe: Timeframe;
  /** Inclusive bar-open range [from, to). */
  from: number;
  to: number;
}

export interface LatestRequest {
  canonicalSymbol: string;
  providerSymbol: string;
  timeframe: Timeframe;
  /** Bars with open >= since. */
  since: number;
  /** Request clock (explicit). */
  now: number;
}

/** Candles returned by adapters carry the PROVIDER symbol; normalization maps them to canonical symbols. */
export interface MarketDataProvider {
  readonly id: string;
  getHistoricalCandles(input: HistoricalRequest): Promise<ProviderResult<Candle[]>>;
  getLatestCandles(input: LatestRequest): Promise<ProviderResult<Candle[]>>;
}

export interface LiveSubscription {
  /** Canonical → provider symbol pairs, resolved by the mapping layer. */
  symbols: { canonicalSymbol: string; providerSymbol: string }[];
  timeframe: Timeframe;
}

export type ProviderEvent =
  | { kind: "BARS"; eventId: string; providerSymbol: string; candles: Candle[]; receivedAt: number }
  | { kind: "FAILURE"; eventId: string; failure: ProviderFailure; receivedAt: number };

export interface SubscriptionHandle {
  readonly id: string;
  close(): Promise<void>;
}

/** Optional streaming/polling source. Events are hints to re-evaluate; bars still pass normalization. */
export interface LiveMarketDataProvider {
  readonly id: string;
  subscribe(request: LiveSubscription, onData: (event: ProviderEvent) => void): Promise<SubscriptionHandle>;
}

/** Provenance of every provider-derived dataset. DATA mode only after deterministic validation. */
export interface MarketDataProvenance {
  provider: string;
  providerSymbol: string;
  canonicalSymbol: string;
  role: FeedRole;
  timeframe: Timeframe;
  fetchedAt: number;
  /** Open time of the latest accepted CLOSED bar. */
  latestMarketTimestamp: number;
  evidenceMode: "DATA";
  normalized: boolean;
  bars: number;
  sessions: number;
  warnings: string[];
}
