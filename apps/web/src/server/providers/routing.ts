import type { Candle, HistoricalRequest, LatestRequest, MarketDataProvider, ProviderResult, SymbolMap, Timeframe } from "../engine-core.ts";
import { assertValidSymbolMap } from "../engine-core.ts";

/**
 * Entitlement-aware routing: each canonical symbol is served by exactly one licensed adapter, at declared intervals.
 * Anything else fails closed as ENTITLEMENT_MISSING. Substitutes are forbidden: SPY is never SPX, NQ is never MNQ.
 */
export interface Entitlement {
  canonicalSymbol: string;
  providerSymbol: string;
  timeframes: readonly Timeframe[];
  /** e.g. "index", "equity", "etf (volume proxy only)", "cme futures". */
  assetClass: string;
}

export interface ProviderRoute {
  provider: MarketDataProvider;
  entitlements: readonly Entitlement[];
  /** Serve any plain US equity ticker (canonical = provider ticker) at these timeframes. */
  equityPassThrough?: readonly Timeframe[];
}

const EQUITY = /^[A-Z]{1,5}$/;
const NON_EQUITY = new Set(["SPX", "MNQ", "NQ", "ES", "MES", "NDX", "VIX", "RUT", "DJI"]);

/** Canonical symbols whose vendor tickers must never be another instrument. */
export const FORBIDDEN_SUBSTITUTIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  SPX: ["SPY", "ES", "ES1!", "SPXL", "VOO", "IVV", "MES"],
  MNQ: ["NQ", "NQ1!", "QQQ", "TQQQ", "NDX", "I:NDX"],
});

export function assertNoSubstitution(map: SymbolMap): void {
  assertValidSymbolMap(map);
  for (const [canonical, banned] of Object.entries(FORBIDDEN_SUBSTITUTIONS)) {
    const mapped = map.entries[canonical];
    if (mapped && banned.includes(mapped)) throw new Error(`symbol map: ${canonical} may not be served by ${mapped} (substitution forbidden)`);
  }
}

export class RoutedProvider implements MarketDataProvider {
  readonly id: string;
  private readonly routes: readonly ProviderRoute[];
  constructor(id: string, routes: readonly ProviderRoute[]) {
    this.id = id;
    this.routes = routes;
    const seen = new Set<string>();
    for (const r of routes) {
      for (const e of r.entitlements) {
        if (seen.has(e.providerSymbol)) throw new Error(`routing: ${e.providerSymbol} is served by more than one provider`);
        seen.add(e.providerSymbol);
        const banned = FORBIDDEN_SUBSTITUTIONS[e.canonicalSymbol];
        if (banned?.includes(e.providerSymbol)) throw new Error(`routing: ${e.canonicalSymbol} may not be served by ${e.providerSymbol}`);
      }
    }
  }

  /** The symbol map implied by the entitlements (canonical → provider ticker). */
  symbolMap(): SymbolMap {
    const entries: Record<string, string> = {};
    for (const r of this.routes) for (const e of r.entitlements) entries[e.canonicalSymbol] = e.providerSymbol;
    const map: SymbolMap = { provider: this.id, entries };
    assertNoSubstitution(map);
    return map;
  }

  entitlements(): Entitlement[] {
    return this.routes.flatMap((r) => r.entitlements);
  }

  private route(providerSymbol: string, timeframe: Timeframe): MarketDataProvider | null {
    for (const r of this.routes) if (r.entitlements.some((e) => e.providerSymbol === providerSymbol && e.timeframes.includes(timeframe))) return r.provider;
    for (const r of this.routes) if (r.equityPassThrough?.includes(timeframe) && EQUITY.test(providerSymbol) && !NON_EQUITY.has(providerSymbol)) return r.provider;
    return null;
  }

  private missing(providerSymbol: string, timeframe: Timeframe): ProviderResult<Candle[]> {
    return { ok: false, failure: { code: "ENTITLEMENT_MISSING", message: `no licensed source for ${providerSymbol} ${timeframe}` } };
  }

  async getHistoricalCandles(r: HistoricalRequest) {
    return this.route(r.providerSymbol, r.timeframe)?.getHistoricalCandles(r) ?? this.missing(r.providerSymbol, r.timeframe);
  }
  async getLatestCandles(r: LatestRequest) {
    return this.route(r.providerSymbol, r.timeframe)?.getLatestCandles(r) ?? this.missing(r.providerSymbol, r.timeframe);
  }
}
