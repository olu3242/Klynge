import type { Candle, HistoricalRequest, LatestRequest, MarketDataProvider, ProviderFailure, ProviderResult } from "../engine-core.ts";

export type ProviderHealthStatus = "HEALTHY" | "DEGRADED" | "DOWN" | "UNKNOWN";

export interface ProviderHealth {
  provider: string;
  status: ProviderHealthStatus;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastFailureCode: ProviderFailure["code"] | null;
  consecutiveFailures: number;
  rateLimitedUntil: number | null;
  requests: number;
  retries: number;
}

export interface ResilienceOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Client-side token bucket (requests); respects plan limits before the vendor has to. */
  capacity?: number;
  refillPerMs?: number;
  sleep?: (ms: number) => Promise<void>;
  clock?: () => number;
}

const RETRYABLE = new Set<ProviderFailure["code"]>(["PROVIDER_UNAVAILABLE", "RATE_LIMITED"]);

/**
 * Bounded retries with exponential backoff (honouring Retry-After), a client-side rate limiter and health reporting.
 * Never retries entitlement/mapping/data-quality failures, and never fabricates data when retries run out.
 */
export class ResilientProvider implements MarketDataProvider {
  readonly id: string;
  private readonly inner: MarketDataProvider;
  private readonly o: Required<ResilienceOptions>;
  private tokens: number;
  private refilledAt: number;
  private readonly h: ProviderHealth;
  constructor(inner: MarketDataProvider, opts: ResilienceOptions = {}) {
    this.inner = inner;
    this.id = inner.id;
    this.o = { maxRetries: 2, baseDelayMs: 500, maxDelayMs: 8_000, capacity: 5, refillPerMs: 5 / 60_000, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), clock: () => Date.now(), ...opts };
    this.tokens = this.o.capacity;
    this.refilledAt = this.o.clock();
    this.h = { provider: inner.id, status: "UNKNOWN", lastSuccessAt: null, lastFailureAt: null, lastFailureCode: null, consecutiveFailures: 0, rateLimitedUntil: null, requests: 0, retries: 0 };
  }

  health(): Readonly<ProviderHealth> {
    return { ...this.h };
  }

  private take(): number {
    const now = this.o.clock();
    this.tokens = Math.min(this.o.capacity, this.tokens + (now - this.refilledAt) * this.o.refillPerMs);
    this.refilledAt = now;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return 0;
    }
    return Math.ceil((1 - this.tokens) / this.o.refillPerMs);
  }

  private async call(fn: () => Promise<ProviderResult<Candle[]>>): Promise<ProviderResult<Candle[]>> {
    let last: ProviderResult<Candle[]> | null = null;
    for (let attempt = 0; attempt <= this.o.maxRetries; attempt++) {
      const wait = this.take();
      if (wait > this.o.maxDelayMs) return this.fail({ code: "RATE_LIMITED", message: "client-side rate limit reached", retryAfterMs: wait });
      if (wait > 0) await this.o.sleep(wait);
      this.h.requests++;
      const r = await fn().catch((): ProviderResult<Candle[]> => ({ ok: false, failure: { code: "PROVIDER_UNAVAILABLE", message: "provider request failed" } }));
      if (r.ok) {
        Object.assign(this.h, { status: "HEALTHY", lastSuccessAt: this.o.clock(), consecutiveFailures: 0, rateLimitedUntil: null });
        return r;
      }
      last = r;
      if (!RETRYABLE.has(r.failure.code) || attempt === this.o.maxRetries) break;
      this.h.retries++;
      const backoff = Math.min(this.o.maxDelayMs, r.failure.retryAfterMs ?? this.o.baseDelayMs * 2 ** attempt);
      await this.o.sleep(backoff);
    }
    return this.fail((last as Extract<ProviderResult<Candle[]>, { ok: false }>).failure);
  }

  private fail(f: ProviderFailure): ProviderResult<Candle[]> {
    const now = this.o.clock();
    this.h.consecutiveFailures++;
    Object.assign(this.h, {
      lastFailureAt: now,
      lastFailureCode: f.code,
      status: f.code === "ENTITLEMENT_MISSING" || f.code === "INVALID_SYMBOL_MAPPING" ? "DEGRADED" : this.h.consecutiveFailures >= 3 ? "DOWN" : "DEGRADED",
      rateLimitedUntil: f.code === "RATE_LIMITED" && f.retryAfterMs ? now + f.retryAfterMs : this.h.rateLimitedUntil,
    });
    return { ok: false, failure: f };
  }

  getHistoricalCandles(r: HistoricalRequest) {
    return this.call(() => this.inner.getHistoricalCandles(r));
  }
  getLatestCandles(r: LatestRequest) {
    return this.call(() => this.inner.getLatestCandles(r));
  }
}
