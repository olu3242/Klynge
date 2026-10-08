import type { ContractMetrics, OptionContract } from "./types.ts";

export const DAY_MS = 24 * 60 * 60_000;

export function dte(expiration: number, now: number): number {
  return (expiration - now) / DAY_MS;
}

/** Deterministic contract metrics. Requires a valid two-sided quote (validated by the caller). */
export function contractMetrics(c: OptionContract, underlyingPrice: number, now: number, multiplier: number): ContractMetrics {
  const mid = (c.bid + c.ask) / 2;
  const spread = c.ask - c.bid;
  const premiumCost = c.ask * multiplier;
  return {
    dte: dte(c.expiration, now),
    mid,
    spread,
    spreadPercent: (spread * 100) / mid,
    moneynessPercent: c.type === "CALL" ? ((underlyingPrice - c.strike) / underlyingPrice) * 100 : ((c.strike - underlyingPrice) / underlyingPrice) * 100,
    premiumCost,
    breakeven: c.type === "CALL" ? c.strike + c.ask : c.strike - c.ask,
    capitalAtRisk: premiumCost,
  };
}
