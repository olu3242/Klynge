/**
 * Deterministic providers for tests, fixtures and offline e2e. No network, no wall clock: every timestamp comes
 * from the request. Real vendor adapters implement the same interfaces behind environment configuration.
 */
import type { Candle } from "../domain/types.ts";
import { TIMEFRAME_MS } from "../timeframe/timeframe.ts";
import type {
  HistoricalRequest,
  LatestRequest,
  LiveMarketDataProvider,
  LiveSubscription,
  MarketDataProvider,
  ProviderEvent,
  ProviderFailure,
  ProviderFailureCode,
  ProviderResult,
  SubscriptionHandle,
} from "./types.ts";

type Bars = Readonly<Record<string, readonly Candle[]>>;

const ok = (providerSymbol: string, value: Candle[], fetchedAt: number): ProviderResult<Candle[]> => ({ ok: true, value, providerSymbol, fetchedAt, warnings: [] });

/** Serves recorded bars keyed by provider symbol. Unknown symbols fail as INVALID_SYMBOL_MAPPING. */
export class MockHistoricalProvider implements MarketDataProvider {
  readonly id: string;
  protected readonly bars: Bars;
  constructor(id: string, bars: Bars) {
    this.id = id;
    this.bars = bars;
  }
  protected series(providerSymbol: string): readonly Candle[] | undefined {
    return this.bars[providerSymbol];
  }
  async getHistoricalCandles(r: HistoricalRequest): Promise<ProviderResult<Candle[]>> {
    const s = this.series(r.providerSymbol);
    if (!s) return { ok: false, failure: { code: "INVALID_SYMBOL_MAPPING", message: `unknown provider symbol ${r.providerSymbol}` } };
    return ok(r.providerSymbol, s.filter((b) => b.timeframe === r.timeframe && b.timestamp >= r.from && b.timestamp < r.to).map((b) => ({ ...b })), r.to);
  }
  async getLatestCandles(r: LatestRequest): Promise<ProviderResult<Candle[]>> {
    const s = this.series(r.providerSymbol);
    if (!s) return { ok: false, failure: { code: "INVALID_SYMBOL_MAPPING", message: `unknown provider symbol ${r.providerSymbol}` } };
    return ok(r.providerSymbol, s.filter((b) => b.timeframe === r.timeframe && b.timestamp >= r.since && b.timestamp <= r.now).map((b) => ({ ...b })), r.now);
  }
}

/** Always fails (outage or rate limit). */
export class FailingProvider implements MarketDataProvider {
  readonly id: string;
  private readonly failure: ProviderFailure;
  constructor(id: string, code: Extract<ProviderFailureCode, "PROVIDER_UNAVAILABLE" | "RATE_LIMITED"> = "PROVIDER_UNAVAILABLE", retryAfterMs?: number) {
    this.id = id;
    this.failure = { code, message: code === "RATE_LIMITED" ? "provider rate limit reached" : "provider unavailable", ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) };
  }
  async getHistoricalCandles(): Promise<ProviderResult<Candle[]>> {
    return { ok: false, failure: { ...this.failure } };
  }
  async getLatestCandles(): Promise<ProviderResult<Candle[]>> {
    return { ok: false, failure: { ...this.failure } };
  }
}

/** Lags the market: hides bars that opened within `lagMs` of the request clock. */
export class StaleProvider implements MarketDataProvider {
  readonly id: string;
  private readonly inner: MarketDataProvider;
  private readonly lagMs: number;
  constructor(inner: MarketDataProvider, lagMs: number) {
    this.id = `${inner.id}+stale`;
    this.inner = inner;
    this.lagMs = lagMs;
  }
  async getHistoricalCandles(r: HistoricalRequest) {
    return this.inner.getHistoricalCandles(r);
  }
  async getLatestCandles(r: LatestRequest): Promise<ProviderResult<Candle[]>> {
    const res = await this.inner.getLatestCandles(r);
    if (!res.ok) return res;
    const tf = TIMEFRAME_MS[r.timeframe];
    return { ...res, value: res.value.filter((b) => b.timestamp + tf <= r.now - this.lagMs) };
  }
}

export type MalformedDefect = "OUT_OF_ORDER" | "DUPLICATE" | "BAD_OHLC" | "MISSING_BAR" | "WRONG_SYMBOL" | "MISALIGNED" | "FUTURE_BAR";

/** Corrupts the latest-bars response in one documented way. */
export class MalformedProvider implements MarketDataProvider {
  readonly id: string;
  private readonly inner: MarketDataProvider;
  private readonly defect: MalformedDefect;
  private readonly only: string | undefined;
  constructor(inner: MarketDataProvider, defect: MalformedDefect, onlyProviderSymbol?: string) {
    this.id = `${inner.id}+${defect.toLowerCase()}`;
    this.inner = inner;
    this.defect = defect;
    this.only = onlyProviderSymbol;
  }
  async getHistoricalCandles(r: HistoricalRequest) {
    return this.inner.getHistoricalCandles(r);
  }
  async getLatestCandles(r: LatestRequest): Promise<ProviderResult<Candle[]>> {
    const res = await this.inner.getLatestCandles(r);
    if (!res.ok || res.value.length < 3 || (this.only && r.providerSymbol !== this.only)) return res;
    const v = res.value.map((b) => ({ ...b }));
    const n = v.length;
    const tf = TIMEFRAME_MS[r.timeframe];
    const last = v[n - 1] as Candle;
    switch (this.defect) {
      case "OUT_OF_ORDER":
        [v[n - 2], v[n - 3]] = [v[n - 3] as Candle, v[n - 2] as Candle];
        break;
      case "DUPLICATE":
        v.splice(n - 1, 0, { ...(v[n - 2] as Candle) });
        break;
      case "BAD_OHLC":
        last.high = last.low - 1;
        break;
      case "MISSING_BAR":
        v.splice(Math.floor(n / 2), 1);
        break;
      case "WRONG_SYMBOL":
        last.symbol = `${last.symbol}X`;
        break;
      case "MISALIGNED":
        last.timestamp += 60_000;
        break;
      case "FUTURE_BAR":
        v.push({ ...last, timestamp: r.now + tf });
        break;
    }
    return { ...res, value: v };
  }
}

/**
 * Scripted live source. `push` delivers bars to subscribers synchronously and also makes them available to
 * `getLatestCandles`, so the runtime re-reads them through normalization (events are never trusted directly).
 */
export class MockLiveProvider extends MockHistoricalProvider implements LiveMarketDataProvider {
  private readonly live = new Map<string, Candle[]>();
  private readonly listeners = new Map<string, { req: LiveSubscription; onData: (e: ProviderEvent) => void }>();
  private seq = 0;
  protected override series(providerSymbol: string): readonly Candle[] | undefined {
    const base = this.bars[providerSymbol];
    const extra = this.live.get(providerSymbol) ?? [];
    return base ? [...base, ...extra] : extra.length ? extra : undefined;
  }
  async subscribe(req: LiveSubscription, onData: (e: ProviderEvent) => void): Promise<SubscriptionHandle> {
    const id = `${this.id}:sub:${++this.seq}`;
    this.listeners.set(id, { req, onData });
    return { id, close: async () => void this.listeners.delete(id) };
  }
  push(providerSymbol: string, candles: readonly Candle[], receivedAt: number): ProviderEvent {
    const list = this.live.get(providerSymbol) ?? [];
    list.push(...candles.map((c) => ({ ...c })));
    this.live.set(providerSymbol, list);
    const event: ProviderEvent = { kind: "BARS", eventId: `${this.id}:${providerSymbol}:${candles.at(-1)?.timestamp ?? receivedAt}`, providerSymbol, candles: candles.map((c) => ({ ...c })), receivedAt };
    for (const { req, onData } of this.listeners.values()) if (req.symbols.some((s) => s.providerSymbol === providerSymbol)) onData(event);
    return event;
  }
  fail(failure: ProviderFailure, receivedAt: number): ProviderEvent {
    const event: ProviderEvent = { kind: "FAILURE", eventId: `${this.id}:failure:${failure.code}:${receivedAt}`, failure, receivedAt };
    for (const { onData } of this.listeners.values()) onData(event);
    return event;
  }
  get subscribers(): number {
    return this.listeners.size;
  }
}

/** Flatten canonical sessions into provider-symbol bars (fixture helper for mocks). */
export function barsFromSessions(sessions: readonly { candles: readonly Candle[] }[], providerSymbol: string): Candle[] {
  return sessions.flatMap((s) => s.candles.map((c) => ({ ...c, symbol: providerSymbol })));
}
