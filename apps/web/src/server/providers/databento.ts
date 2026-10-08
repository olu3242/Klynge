import type { Candle, ProviderResult } from "../engine-core.ts";
import type { FuturesBarsSource } from "./cme-futures.ts";

/**
 * Databento historical OHLCV source (CME Globex `GLBX.MDP3`, schema `ohlcv-1m`), built from the documented
 * `timeseries.get_range` HTTP API (JSON encoding, pretty prices/timestamps). Authentication: HTTP Basic with the API
 * key as username (server-only DATABENTO_API_KEY). Licensing of the dataset is declared by the operator and enforced
 * before every request; vendor 401/403 responses are mapped to ENTITLEMENT_MISSING. Live use is unverified until
 * exercised with a licensed key.
 */
export class DatabentoBarsSource implements FuturesBarsSource {
  readonly id = "databento";
  readonly dataset = "GLBX.MDP3";
  readonly licensedDatasets: readonly string[];
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly clock: () => number;
  constructor(cfg: { apiKey: string; licensedDatasets: readonly string[]; baseUrl?: string; fetch?: typeof fetch; clock?: () => number }) {
    if (!cfg.apiKey) throw new Error("databento: DATABENTO_API_KEY required (server-only)");
    this.apiKey = cfg.apiKey;
    this.licensedDatasets = cfg.licensedDatasets;
    this.baseUrl = (cfg.baseUrl ?? "https://hist.databento.com").replace(/\/$/, "");
    this.fetchImpl = cfg.fetch ?? fetch;
    this.clock = cfg.clock ?? (() => Date.now());
  }

  async fetchMinuteBars(contractSymbol: string, from: number, to: number): Promise<ProviderResult<Candle[]>> {
    const q = new URLSearchParams({ dataset: this.dataset, schema: "ohlcv-1m", symbols: contractSymbol, stype_in: "raw_symbol", start: new Date(from).toISOString(), end: new Date(to).toISOString(), encoding: "json", pretty_px: "true", pretty_ts: "true" });
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/v0/timeseries.get_range?${q}`, { headers: { Authorization: `Basic ${Buffer.from(`${this.apiKey}:`).toString("base64")}`, Accept: "application/json" } });
    } catch {
      return { ok: false, failure: { code: "PROVIDER_UNAVAILABLE", message: "provider request failed" } };
    }
    if (res.status === 429) {
      const ra = Number(res.headers.get("retry-after"));
      return { ok: false, failure: { code: "RATE_LIMITED", message: "provider rate limit reached", ...(Number.isFinite(ra) && ra > 0 ? { retryAfterMs: ra * 1000 } : {}) } };
    }
    if (res.status === 401 || res.status === 403) return { ok: false, failure: { code: "ENTITLEMENT_MISSING", message: `${this.dataset} access not licensed for this key` } };
    if (res.status === 422 || res.status === 404) return { ok: false, failure: { code: "INVALID_SYMBOL_MAPPING", message: `provider does not know ${contractSymbol}` } };
    if (!res.ok) return { ok: false, failure: { code: "PROVIDER_UNAVAILABLE", message: `provider error ${res.status}` } };
    const text = await res.text();
    const bars: Candle[] = [];
    const raw: unknown[] = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let r: { hd?: { ts_event?: string }; symbol?: string; open?: string; high?: string; low?: string; close?: string; volume?: string | number };
      try {
        r = JSON.parse(line);
      } catch {
        return { ok: false, failure: { code: "MALFORMED_BARS", message: "provider returned malformed records" } };
      }
      raw.push(r);
      const ts = Date.parse(r.hd?.ts_event ?? "");
      const num = (v: unknown) => (typeof v === "string" || typeof v === "number" ? Number(v) : Number.NaN);
      bars.push({ symbol: r.symbol ?? contractSymbol, timeframe: "1m", timestamp: ts, open: num(r.open), high: num(r.high), low: num(r.low), close: num(r.close), volume: num(r.volume) });
    }
    return { ok: true, value: bars, providerSymbol: contractSymbol, fetchedAt: this.clock(), warnings: [], raw };
  }
}
