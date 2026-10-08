import type { TradingSession } from "../domain/types.ts";
import { bullTargetFeed, END, M5, trendFeed } from "../mtf-test-fixtures.ts";
import { DAY_MS } from "../options/metrics.ts";
import type { OptionChainSnapshot, OptionContract } from "../options/types.ts";
import type { ReplayInput } from "./types.ts";

export const POLICY = { macro: "1d", structure: "1h", setup: "15m", execution: "5m" } as const;

export function optionContract(ts: number, o: Partial<OptionContract> = {}): OptionContract {
  return { symbol: `TSLA-C-105-${ts}`, underlying: "TSLA", type: "CALL", strike: 105, expiration: ts + 21 * DAY_MS, bid: 2, ask: 2.1, volume: 500, openInterest: 2000, delta: 0.5, timestamp: ts, ...o };
}

export const chainAt = (ts: number, o: Partial<OptionContract> = {}): OptionChainSnapshot => ({ underlying: "TSLA", timestamp: ts, contracts: [optionContract(ts, o)] });

export function replayInput(side: "BULLISH" | "BEARISH" = "BULLISH", chains: OptionChainSnapshot[] = [chainAt(END - 1_000)]): ReplayInput {
  const d = side === "BULLISH" ? 0.05 : -0.05;
  return { target: bullTargetFeed("TSLA", side), spx: trendFeed("SPX", d, 5000), mnq: trendFeed("MNQ", d, 18000), timeframePolicy: POLICY, optionChains: chains };
}

/** Replace every current-session candle that OPENS at/after `from` with wild values (future perturbation). */
export function perturbFuture(feed: readonly TradingSession[], from: number, factor = 3): TradingSession[] {
  return feed.map((s, i) =>
    i < feed.length - 1
      ? s
      : { ...s, candles: s.candles.map((c) => (c.timestamp >= from ? { ...c, open: c.open * factor, high: c.high * factor * 1.1, low: c.low * factor * 0.9, close: c.close * factor, volume: c.volume * 7 } : c)) },
  );
}

export { END, M5 };
