import { activeContract, aggregateBars, DEFAULT_ROLL_RULE } from "../engine-core.ts";
import type { Candle, HistoricalRequest, LatestRequest, MarketDataProvider, ProviderResult, RollRule, SessionCalendar } from "../engine-core.ts";

/** Vendor-specific raw futures bars (1m), addressed by exact exchange contract symbol (e.g. MNQZ6). */
export interface FuturesBarsSource {
  readonly id: string;
  /** Dataset/feeds this account is licensed for (checked before any request). */
  readonly licensedDatasets: readonly string[];
  readonly dataset: string;
  fetchMinuteBars(contractSymbol: string, from: number, to: number): Promise<ProviderResult<Candle[]>>;
}

/**
 * Vendor-neutral CME futures provider for canonical futures (MNQ). Resolves the FRONT contract for the request's
 * evaluation time, fetches that single contract's minute bars for the whole window (no stitching, no
 * back-adjustment), aggregates them on the CME session calendar, and returns them under the canonical provider
 * symbol. A different root (NQ for MNQ) can never be configured.
 */
export class CmeFuturesProvider implements MarketDataProvider {
  readonly id: string;
  private readonly source: FuturesBarsSource;
  private readonly calendar: SessionCalendar;
  private readonly roots: Readonly<Record<string, string>>;
  private readonly rule: RollRule;
  constructor(cfg: { source: FuturesBarsSource; calendar: SessionCalendar; roots: Readonly<Record<string, string>>; rollRule?: RollRule }) {
    for (const [providerSymbol, root] of Object.entries(cfg.roots)) {
      const canonical = providerSymbol.replace(/^CME:/, "");
      if (canonical !== root) throw new Error(`cme: ${providerSymbol} must use root ${canonical}, not ${root} (no substitution)`);
    }
    this.id = `cme:${cfg.source.id}`;
    this.source = cfg.source;
    this.calendar = cfg.calendar;
    this.roots = cfg.roots;
    this.rule = cfg.rollRule ?? DEFAULT_ROLL_RULE;
  }

  private async bars(providerSymbol: string, timeframe: HistoricalRequest["timeframe"], from: number, to: number, evaluationTime: number): Promise<ProviderResult<Candle[]>> {
    const root = this.roots[providerSymbol];
    if (!root) return { ok: false, failure: { code: "INVALID_SYMBOL_MAPPING", message: `no CME root configured for ${providerSymbol}` } };
    if (!this.source.licensedDatasets.includes(this.source.dataset)) return { ok: false, failure: { code: "ENTITLEMENT_MISSING", message: `${this.source.dataset} is not licensed for this account` } };
    const contract = activeContract(root, evaluationTime, this.rule);
    const raw = await this.source.fetchMinuteBars(contract.symbol, from, to);
    if (!raw.ok) return raw;
    if (raw.value.some((b) => b.symbol !== contract.symbol)) return { ok: false, failure: { code: "INVALID_SYMBOL_MAPPING", message: `vendor returned bars for another contract than ${contract.symbol}` } };
    const agg = aggregateBars(
      raw.value.map((b) => ({ ...b, symbol: providerSymbol })),
      timeframe,
      this.calendar,
      to,
    ).filter((b) => b.timestamp >= from && b.timestamp < to);
    return { ok: true, value: agg, providerSymbol, fetchedAt: raw.fetchedAt, warnings: [...raw.warnings, `front contract ${contract.symbol} (rolls ${new Date(contract.rollAt).toISOString().slice(0, 10)})`], ...(raw.raw ? { raw: raw.raw } : {}) };
  }

  getHistoricalCandles(r: HistoricalRequest) {
    return this.bars(r.providerSymbol, r.timeframe, r.from, r.to, r.to);
  }
  getLatestCandles(r: LatestRequest) {
    return this.bars(r.providerSymbol, r.timeframe, r.since, r.now + 1, r.now);
  }
}

/** Deterministic test/fixture source keyed by contract symbol. */
export class MockFuturesBarsSource implements FuturesBarsSource {
  readonly id = "mock-futures";
  readonly dataset = "GLBX.MDP3";
  readonly licensedDatasets: readonly string[];
  private readonly bars: Readonly<Record<string, readonly Candle[]>>;
  readonly requests: string[] = [];
  constructor(bars: Readonly<Record<string, readonly Candle[]>>, licensedDatasets: readonly string[] = ["GLBX.MDP3"]) {
    this.bars = bars;
    this.licensedDatasets = licensedDatasets;
  }
  async fetchMinuteBars(contractSymbol: string, from: number, to: number): Promise<ProviderResult<Candle[]>> {
    this.requests.push(contractSymbol);
    const s = this.bars[contractSymbol];
    if (!s) return { ok: false, failure: { code: "INVALID_SYMBOL_MAPPING", message: `unknown contract ${contractSymbol}` } };
    return { ok: true, value: s.filter((b) => b.timestamp >= from && b.timestamp < to).map((b) => ({ ...b })), providerSymbol: contractSymbol, fetchedAt: to, warnings: [] };
  }
}
