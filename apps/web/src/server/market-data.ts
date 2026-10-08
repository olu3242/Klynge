import { readFileSync } from "node:fs";
import path from "node:path";
import { barsFromSessions, cmeEquityIndexCalendar, FailingProvider, fixedSessionCalendar, MalformedProvider, MockHistoricalProvider, nyseCalendar, StaleProvider } from "./engine-core.ts";
import type { FeedRole, MarketDataProvider, SessionCalendar, SymbolMap, TimeframePolicy, TradingSession } from "./engine-core.ts";
import { PolygonProvider } from "./providers/polygon.ts";
import { ResilientProvider } from "./providers/resilient.ts";
import type { ProviderHealth } from "./providers/resilient.ts";
import { assertNoSubstitution, RoutedProvider } from "./providers/routing.ts";
import type { Entitlement } from "./providers/routing.ts";

/** Server-side market-data wiring. Vendor credentials (future adapters) are server-only env and never reach the client. */
export interface MarketDataSetup {
  label: string;
  provider: MarketDataProvider;
  calendar: SessionCalendar;
  symbolMap: SymbolMap;
  timeframePolicy: TimeframePolicy;
  historySessions: number;
  /** Per-role exchange calendars (e.g. MNQ on CME Globex). */
  calendars?: Partial<Record<FeedRole, SessionCalendar>>;
  /** Live provider health (real adapters). */
  health?: () => ProviderHealth[];
  entitlements?: Entitlement[];
  live: boolean;
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
    live: false,
  };
}

const PROD_POLICY: TimeframePolicy = { macro: "1d", structure: "1h", setup: "15m", execution: "5m" };
const TF = ["5m", "15m", "1h", "1d"] as const;

/**
 * Polygon/Massive (stocks + indices, per the operator-declared plans). MNQ is mapped to its CME ticker but has NO
 * licensed source in this adapter, so DATA mode fails closed (ENTITLEMENT_MISSING) until a CME futures adapter is
 * configured. Nothing is substituted.
 */
export function polygonMarketData(env: Readonly<Record<string, string | undefined>>, fetchImpl?: typeof fetch): MarketDataSetup {
  const apiKey = env.POLYGON_API_KEY;
  if (!apiKey) throw new Error("KLYNGE_PROVIDER=polygon requires the server-only POLYGON_API_KEY");
  const plans = new Set((env.KLYNGE_POLYGON_PLANS ?? "stocks").split(",").map((p) => p.trim().toLowerCase()));
  const polygon = new ResilientProvider(new PolygonProvider({ apiKey, ...(env.KLYNGE_POLYGON_BASE_URL ? { baseUrl: env.KLYNGE_POLYGON_BASE_URL } : {}), ...(fetchImpl ? { fetch: fetchImpl } : {}) }));
  const entitlements: Entitlement[] = [];
  if (plans.has("indices")) entitlements.push({ canonicalSymbol: "SPX", providerSymbol: "I:SPX", timeframes: TF, assetClass: "index" });
  if (plans.has("stocks")) entitlements.push({ canonicalSymbol: "SPY", providerSymbol: "SPY", timeframes: TF, assetClass: "etf (volume proxy only)" });
  const routed = new RoutedProvider("polygon", [{ provider: polygon, entitlements, ...(plans.has("stocks") ? { equityPassThrough: TF } : {}) }]);
  const symbolMap: SymbolMap = { provider: "polygon", entries: { SPX: "I:SPX", SPY: "SPY", MNQ: "CME:MNQ" }, passThroughUnmapped: true };
  assertNoSubstitution(symbolMap);
  return {
    label: "Polygon/Massive aggregates",
    provider: routed,
    calendar: nyseCalendar(),
    calendars: { MNQ: cmeEquityIndexCalendar() },
    symbolMap,
    timeframePolicy: PROD_POLICY,
    historySessions: 20,
    health: () => [polygon.health()],
    entitlements: routed.entitlements(),
    live: true,
  };
}

/** KLYNGE_PROVIDER=mock (offline fixture) | none (default). Real vendor adapters plug in here behind env config. */
export function marketDataFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): MarketDataSetup | null {
  if (env.KLYNGE_PROVIDER === "mock") return mockMarketData(path.resolve(env.KLYNGE_PROVIDER_FIXTURE ?? path.join(process.cwd(), "test/fixtures/ohlcv-call.json")));
  if (env.KLYNGE_PROVIDER === "polygon") return polygonMarketData(env);
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
