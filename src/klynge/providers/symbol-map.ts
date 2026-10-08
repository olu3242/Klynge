import type { FeedRole } from "./types.ts";

/**
 * Canonical ↔ provider symbol mapping. The engine only ever sees canonical symbols (SPX, MNQ, TSLA…); vendor
 * tickers live here. A missing or ambiguous mapping fails closed (INVALID_SYMBOL_MAPPING).
 */
export interface SymbolMap {
  provider: string;
  /** canonical -> provider symbol. */
  entries: Readonly<Record<string, string>>;
  /** When true, canonical symbols without an entry pass through unchanged (equities that share tickers). */
  passThroughUnmapped?: boolean;
}

const CANONICAL = /^[A-Z][A-Z0-9.^/_-]{0,11}$/;

export function assertValidSymbolMap(map: SymbolMap): void {
  const seen = new Map<string, string>();
  for (const [canonical, providerSymbol] of Object.entries(map.entries)) {
    if (!CANONICAL.test(canonical)) throw new RangeError(`symbol map: invalid canonical symbol ${canonical}`);
    if (!providerSymbol) throw new RangeError(`symbol map: empty provider symbol for ${canonical}`);
    const prior = seen.get(providerSymbol);
    if (prior) throw new RangeError(`symbol map: ${providerSymbol} maps to both ${prior} and ${canonical}`);
    seen.set(providerSymbol, canonical);
  }
}

export function toProviderSymbol(map: SymbolMap, canonical: string): string | null {
  if (!CANONICAL.test(canonical)) return null;
  const mapped = map.entries[canonical];
  if (mapped) return mapped;
  if (!map.passThroughUnmapped) return null;
  // A pass-through symbol must not collide with another canonical symbol's provider ticker.
  return Object.values(map.entries).includes(canonical) ? null : canonical;
}

export function toCanonicalSymbol(map: SymbolMap, providerSymbol: string): string | null {
  for (const [canonical, p] of Object.entries(map.entries)) if (p === providerSymbol) return canonical;
  return map.passThroughUnmapped && CANONICAL.test(providerSymbol) && !(providerSymbol in map.entries) ? providerSymbol : null;
}

export interface FeedPlan {
  role: FeedRole;
  canonicalSymbol: string;
  providerSymbol: string;
}

/** Resolve every role to a provider symbol, or report which canonical symbols cannot be mapped. */
export function planFeeds(map: SymbolMap, roles: readonly { role: FeedRole; canonicalSymbol: string }[]): { plans: FeedPlan[]; unmapped: { role: FeedRole; canonicalSymbol: string }[] } {
  const plans: FeedPlan[] = [];
  const unmapped: { role: FeedRole; canonicalSymbol: string }[] = [];
  for (const r of roles) {
    const providerSymbol = toProviderSymbol(map, r.canonicalSymbol);
    if (providerSymbol) plans.push({ ...r, providerSymbol });
    else unmapped.push(r);
  }
  return { plans, unmapped };
}
