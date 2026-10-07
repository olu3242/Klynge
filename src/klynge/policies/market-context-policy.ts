/**
 * Market-context roles. Each instrument has exactly one job:
 *   SPX  = broad-market PRICE / STRUCTURE truth (price, EMA, structure, direction)
 *   MNQ  = technology / RISK_CONFIRMATION
 *   SPY|ES = optional VOLUME_PROXY — volume context ONLY (VWAP weights, relative volume).
 * A volume proxy can never replace SPX price, EMA, structure or direction.
 */
export type MarketContextRole = "PRICE_STRUCTURE" | "RISK_CONFIRMATION" | "VOLUME_PROXY";

export interface MarketContextSource {
  symbol: string;
  role: MarketContextRole;
}

export interface MarketContextPolicy {
  broadMarketSymbol: string;
  technologyConfirmationSymbol: string;
  /** null => no proxy permitted; SPX native volume must be used (zero volume fails closed). */
  volumeProxySymbol: string | null;
}

export const DEFAULT_MARKET_CONTEXT_POLICY: Readonly<MarketContextPolicy> = Object.freeze({
  broadMarketSymbol: "SPX",
  technologyConfirmationSymbol: "MNQ",
  volumeProxySymbol: "SPY",
});

export function assertValidMarketContextPolicy(policy: MarketContextPolicy): void {
  const symbols = [policy.broadMarketSymbol, policy.technologyConfirmationSymbol, policy.volumeProxySymbol].filter((s): s is string => s !== null);
  if (symbols.some((s) => typeof s !== "string" || s.trim() === "")) throw new RangeError("MarketContextPolicy symbols must be non-empty");
  if (new Set(symbols).size !== symbols.length) throw new RangeError("MarketContextPolicy roles must use distinct symbols");
}

export function marketContextSources(policy: MarketContextPolicy): MarketContextSource[] {
  const out: MarketContextSource[] = [
    { symbol: policy.broadMarketSymbol, role: "PRICE_STRUCTURE" },
    { symbol: policy.technologyConfirmationSymbol, role: "RISK_CONFIRMATION" },
  ];
  if (policy.volumeProxySymbol !== null) out.push({ symbol: policy.volumeProxySymbol, role: "VOLUME_PROXY" });
  return out;
}
