export interface RateLimitPolicy {
  capacity: number;
  refillPerMs: number;
}

/** PROVISIONAL: 20 extractions burst, refilling 20 per hour, per tenant. */
export const DEFAULT_EXTRACTION_RATE_LIMIT: RateLimitPolicy = { capacity: 20, refillPerMs: 20 / 3_600_000 };

/** Deterministic token bucket (explicit clock). */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  private readonly policy: RateLimitPolicy;
  constructor(policy: RateLimitPolicy = DEFAULT_EXTRACTION_RATE_LIMIT) {
    this.policy = policy;
  }

  take(key: string, now: number): { allowed: boolean; retryAfterMs: number } {
    const b = this.buckets.get(key) ?? { tokens: this.policy.capacity, at: now };
    const tokens = Math.min(this.policy.capacity, b.tokens + Math.max(0, now - b.at) * this.policy.refillPerMs);
    if (tokens < 1) {
      this.buckets.set(key, { tokens, at: now });
      return { allowed: false, retryAfterMs: Math.ceil((1 - tokens) / this.policy.refillPerMs) };
    }
    this.buckets.set(key, { tokens: tokens - 1, at: now });
    return { allowed: true, retryAfterMs: 0 };
  }
}
