import type { Candle, HistoricalRequest, LatestRequest, MarketDataProvider, ProviderResult, Timeframe } from "../engine-core.ts";

/**
 * Polygon.io / Massive aggregates adapter (REST `GET /v2/aggs/ticker/{ticker}/range/{n}/{span}/{from}/{to}`).
 * Covers US stocks/ETFs and indices (`I:SPX`) — subject to the account's plan. It does NOT cover CME futures
 * (MNQ): those requests fail as ENTITLEMENT_MISSING; nothing is substituted. The API key is server-only and sent as
 * a Bearer header (never in URLs or logs). Bars carry the provider ticker; normalization maps them to canonical.
 */
export interface PolygonConfig {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Clock for `fetchedAt` (injectable for tests). */
  clock?: () => number;
}

const SPAN: Record<Timeframe, [number, string]> = { "1m": [1, "minute"], "5m": [5, "minute"], "15m": [15, "minute"], "30m": [30, "minute"], "1h": [1, "hour"], "4h": [4, "hour"], "1d": [1, "day"] };

interface AggResponse {
  status?: string;
  ticker?: string;
  results?: { t: number; o: number; h: number; l: number; c: number; v?: number }[];
  next_url?: string;
  error?: string;
  message?: string;
}

export class PolygonProvider implements MarketDataProvider {
  readonly id = "polygon";
  private readonly cfg: Required<Omit<PolygonConfig, "fetch">> & { fetch: typeof fetch };
  constructor(cfg: PolygonConfig) {
    if (!cfg.apiKey) throw new Error("polygon: API key required (server-only POLYGON_API_KEY)");
    this.cfg = { apiKey: cfg.apiKey, baseUrl: (cfg.baseUrl ?? "https://api.polygon.io").replace(/\/$/, ""), fetch: cfg.fetch ?? fetch, clock: cfg.clock ?? (() => Date.now()) };
  }

  private async range(providerSymbol: string, timeframe: Timeframe, from: number, to: number): Promise<ProviderResult<Candle[]>> {
    const [mult, span] = SPAN[timeframe];
    if (to <= from) return { ok: true, value: [], providerSymbol, fetchedAt: this.cfg.clock(), warnings: [], raw: [] };
    let url: string | null = `${this.cfg.baseUrl}/v2/aggs/ticker/${encodeURIComponent(providerSymbol)}/range/${mult}/${span}/${from}/${to - 1}?adjusted=true&sort=asc&limit=50000`;
    const bars: Candle[] = [];
    const raw: unknown[] = [];
    const warnings: string[] = [];
    for (let page = 0; url && page < 50; page++) {
      if (!url.startsWith(`${this.cfg.baseUrl}/`)) return { ok: false, failure: { code: "PROVIDER_UNAVAILABLE", message: "provider pagination left the configured host" } };
      let res: Response;
      try {
        res = await this.cfg.fetch(url, { headers: { Authorization: `Bearer ${this.cfg.apiKey}`, Accept: "application/json" } });
      } catch {
        return { ok: false, failure: { code: "PROVIDER_UNAVAILABLE", message: "provider request failed" } };
      }
      if (res.status === 429) {
        const ra = Number(res.headers.get("retry-after"));
        return { ok: false, failure: { code: "RATE_LIMITED", message: "provider rate limit reached", ...(Number.isFinite(ra) && ra > 0 ? { retryAfterMs: ra * 1000 } : {}) } };
      }
      if (res.status === 401 || res.status === 403) return { ok: false, failure: { code: "ENTITLEMENT_MISSING", message: `provider plan does not include ${providerSymbol} ${timeframe} aggregates` } };
      if (res.status === 404) return { ok: false, failure: { code: "INVALID_SYMBOL_MAPPING", message: `provider does not know ${providerSymbol}` } };
      if (!res.ok) return { ok: false, failure: { code: "PROVIDER_UNAVAILABLE", message: `provider error ${res.status}` } };
      let body: AggResponse;
      try {
        body = (await res.json()) as AggResponse;
      } catch {
        return { ok: false, failure: { code: "MALFORMED_BARS", message: "provider returned malformed JSON" } };
      }
      raw.push(body);
      if (body.status === "ERROR" || body.status === "NOT_AUTHORIZED") return { ok: false, failure: { code: body.status === "NOT_AUTHORIZED" ? "ENTITLEMENT_MISSING" : "PROVIDER_UNAVAILABLE", message: "provider reported an error" } };
      if (body.status === "DELAYED") warnings.push("provider marked these aggregates as delayed");
      if (body.ticker && body.ticker !== providerSymbol) return { ok: false, failure: { code: "INVALID_SYMBOL_MAPPING", message: `provider answered for ${body.ticker}` } };
      for (const r of body.results ?? []) {
        if (r.v === undefined) warnings.push("bars without volume (index): a permitted volume proxy is required for volume context");
        bars.push({ symbol: providerSymbol, timeframe, timestamp: r.t, open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v ?? 0 });
      }
      url = body.next_url ?? null;
    }
    if (url) return { ok: false, failure: { code: "PROVIDER_UNAVAILABLE", message: "provider pagination did not terminate" } };
    return { ok: true, value: bars, providerSymbol, fetchedAt: this.cfg.clock(), warnings: [...new Set(warnings)], raw };
  }

  getHistoricalCandles(r: HistoricalRequest) {
    return this.range(r.providerSymbol, r.timeframe, r.from, r.to);
  }
  getLatestCandles(r: LatestRequest) {
    return this.range(r.providerSymbol, r.timeframe, r.since, r.now + 1);
  }
}
