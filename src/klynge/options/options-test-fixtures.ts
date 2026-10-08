import { evaluate } from "../triggers/trigger-test-helpers.ts";
import { FIVE_MIN, T0 } from "../test-fixtures.ts";
import { DAY_MS } from "./metrics.ts";
import type { OptionChainSnapshot, OptionContract } from "./types.ts";

/** Clock of the single-session setup fixture (CALL_SETUP / PUT_SETUP at the last bar). */
export const NOW = T0 + 28 * FIVE_MIN;
export const UNDERLYING_PRICE = 102.55;

export const callSetup = () => evaluate();
export const putSetup = () => evaluate({ side: "BEARISH" });

/** GOOD-liquidity contract under default policy (spread 4.88%, vol 500, OI 2000, DTE 21, delta 0.5). */
export function contract(o: Partial<OptionContract> = {}): OptionContract {
  const type = o.type ?? "CALL";
  return {
    symbol: `TSLA-${type}-${o.strike ?? 105}-${o.expiration ?? 21}`,
    underlying: "TSLA",
    type,
    strike: 105,
    expiration: NOW + 21 * DAY_MS,
    bid: 2.0,
    ask: 2.1,
    volume: 500,
    openInterest: 2000,
    delta: type === "CALL" ? 0.5 : -0.5,
    timestamp: NOW - 1_000,
    ...o,
  };
}

export const chain = (contracts: OptionContract[], o: Partial<OptionChainSnapshot> = {}): OptionChainSnapshot => ({ underlying: "TSLA", timestamp: NOW - 1_000, contracts, ...o });
