import { bullTargetFeed, DAY, dayOpen, END, M15, M5, SESSION_MS, trendFeed } from "../mtf-test-fixtures.ts";
import type { TradingSession } from "../domain/types.ts";
import { fixedSessionCalendar } from "./calendar.ts";
import { barsFromSessions, MockHistoricalProvider } from "./mock-providers.ts";
import type { SymbolMap } from "./symbol-map.ts";
import type { RuntimeConfig } from "../runtime/live-runtime.ts";

export { DAY, END, M15, M5 };
export const POLICY = { macro: "1d", structure: "1h", setup: "15m", execution: "5m" } as const;
export const CALENDAR = fixedSessionCalendar({ anchorOpen: dayOpen(0), lengthMs: SESSION_MS, periodMs: DAY });
export const SYMBOLS: SymbolMap = { provider: "mock", entries: { SPX: "I:SPX", MNQ: "MNQ1!", SPY: "SPY.US" }, passThroughUnmapped: true };

export interface Feeds {
  TSLA: TradingSession[];
  SPX: TradingSession[];
  MNQ: TradingSession[];
}
export const bullFeeds = (): Feeds => ({ TSLA: bullTargetFeed(), SPX: trendFeed("SPX", 0.05, 5000), MNQ: trendFeed("MNQ", 0.05, 18000) });
export const mixedFeeds = (): Feeds => ({ ...bullFeeds(), MNQ: trendFeed("MNQ", -0.05, 18000) });

export function providerFor(feeds: Feeds, id = "mock"): MockHistoricalProvider {
  return new MockHistoricalProvider(id, { TSLA: barsFromSessions(feeds.TSLA, "TSLA"), "I:SPX": barsFromSessions(feeds.SPX, "I:SPX"), "MNQ1!": barsFromSessions(feeds.MNQ, "MNQ1!") });
}

export const config = (over: Partial<RuntimeConfig> = {}): RuntimeConfig => ({
  runtimeId: "rt-tsla",
  sessionId: "s1",
  targetSymbol: "TSLA",
  timeframePolicy: POLICY,
  historySessions: 24,
  calendar: CALENDAR,
  symbolMap: SYMBOLS,
  ...over,
});
