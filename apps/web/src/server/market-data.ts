import { readFileSync } from "node:fs";
import path from "node:path";
import { barsFromSessions, FailingProvider, fixedSessionCalendar, MalformedProvider, MockHistoricalProvider, StaleProvider } from "./engine-core.ts";
import type { MarketDataProvider, SessionCalendar, SymbolMap, TimeframePolicy, TradingSession } from "./engine-core.ts";

/** Server-side market-data wiring. Vendor credentials (future adapters) are server-only env and never reach the client. */
export interface MarketDataSetup {
  label: string;
  provider: MarketDataProvider;
  calendar: SessionCalendar;
  symbolMap: SymbolMap;
  timeframePolicy: TimeframePolicy;
  historySessions: number;
}

export const PROVIDER_SCENARIOS = ["good", "stale", "missing-bar", "outage", "rate-limited"] as const;
export type ProviderScenario = (typeof PROVIDER_SCENARIOS)[number];

const DAY = 24 * 60 * 60_000;
const MOCK_SYMBOLS: SymbolMap = { provider: "mock", entries: { SPX: "I:SPX", MNQ: "MNQ1!", SPY: "SPY.US" }, passThroughUnmapped: true };

/** Deterministic offline provider over a recorded OHLCV fixture (target + SPX + MNQ sessions). */
export function mockMarketData(fixturePath: string): MarketDataSetup {
  const f = JSON.parse(readFileSync(fixturePath, "utf8")) as { target: TradingSession[]; spx: TradingSession[]; mnq: TradingSession[]; timeframePolicy: TimeframePolicy };
  const first = f.spx[0] as TradingSession;
  const target = (f.target[0] as TradingSession).symbol;
  return {
    label: "Mock market data (recorded fixture)",
    provider: new MockHistoricalProvider("mock", { [target]: barsFromSessions(f.target, target), "I:SPX": barsFromSessions(f.spx, "I:SPX"), "MNQ1!": barsFromSessions(f.mnq, "MNQ1!") }),
    calendar: fixedSessionCalendar({ anchorOpen: first.openTimestamp, lengthMs: first.closeTimestamp - first.openTimestamp, periodMs: DAY }),
    symbolMap: MOCK_SYMBOLS,
    timeframePolicy: f.timeframePolicy,
    historySessions: f.target.length - 1,
  };
}

/** KLYNGE_PROVIDER=mock (offline fixture) | none (default). Real vendor adapters plug in here behind env config. */
export function marketDataFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): MarketDataSetup | null {
  if (env.KLYNGE_PROVIDER === "mock") return mockMarketData(path.resolve(env.KLYNGE_PROVIDER_FIXTURE ?? path.join(process.cwd(), "test/fixtures/ohlcv-call.json")));
  return null;
}

/** Test-mode failure injection (stale / missing bar / outage / rate limit) over the same setup. */
export function withScenario(setup: MarketDataSetup, scenario: ProviderScenario): MarketDataSetup {
  const p = setup.provider;
  const provider =
    scenario === "stale" ? new StaleProvider(p, 30 * 60_000)
    : scenario === "missing-bar" ? new MalformedProvider(p, "MISSING_BAR")
    : scenario === "outage" ? new FailingProvider("mock", "PROVIDER_UNAVAILABLE")
    : scenario === "rate-limited" ? new FailingProvider("mock", "RATE_LIMITED", 60_000)
    : p;
  return { ...setup, provider };
}
