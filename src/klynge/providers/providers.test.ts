import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Candle } from "../domain/types.ts";
import { fixedSessionCalendar } from "./calendar.ts";
import { FailingProvider, MalformedProvider, MockHistoricalProvider, StaleProvider } from "./mock-providers.ts";
import type { MalformedDefect } from "./mock-providers.ts";
import { assembleFeeds, normalizeFeed, providerFailurePermission } from "./normalize.ts";
import type { NormalizedFeed } from "./normalize.ts";
import { bullFeeds, CALENDAR, END, M5, providerFor, SYMBOLS } from "./provider-test-fixtures.ts";
import { assertValidSymbolMap, planFeeds, toCanonicalSymbol, toProviderSymbol } from "./symbol-map.ts";
import type { MarketDataProvider } from "./types.ts";

const windows = CALENDAR.recentSessions(END, 25);
const FROM = windows[0]!.openTimestamp;
const CUR = windows.at(-1)!.openTimestamp;

async function feed(provider: MarketDataProvider, canonical = "TSLA", now = END): Promise<NormalizedFeed> {
  const providerSymbol = toProviderSymbol(SYMBOLS, canonical)!;
  const plan = { role: canonical === "TSLA" ? ("TARGET" as const) : canonical === "SPX" ? ("SPX" as const) : ("MNQ" as const), canonicalSymbol: canonical, providerSymbol };
  const history = await provider.getHistoricalCandles({ canonicalSymbol: canonical, providerSymbol, timeframe: "5m", from: FROM, to: CUR });
  const latest = await provider.getLatestCandles({ canonicalSymbol: canonical, providerSymbol, timeframe: "5m", since: CUR, now });
  return normalizeFeed({ provider: provider.id, plan, timeframe: "5m", results: [history, latest], calendar: CALENDAR, from: FROM, now, fetchedAt: now });
}
const code = (f: NormalizedFeed) => (f.ok ? "OK" : f.failure.code);

describe("symbol mapping layer", () => {
  it("maps canonical ↔ provider symbols; unmapped fails closed unless pass-through", () => {
    assert.equal(toProviderSymbol(SYMBOLS, "SPX"), "I:SPX");
    assert.equal(toProviderSymbol(SYMBOLS, "TSLA"), "TSLA");
    assert.equal(toCanonicalSymbol(SYMBOLS, "MNQ1!"), "MNQ");
    assert.equal(toProviderSymbol({ provider: "x", entries: { SPX: "I:SPX" } }, "TSLA"), null);
    assert.equal(toProviderSymbol(SYMBOLS, "bad symbol"), null);
    const { plans, unmapped } = planFeeds({ provider: "x", entries: { SPX: "I:SPX" } }, [{ role: "SPX", canonicalSymbol: "SPX" }, { role: "MNQ", canonicalSymbol: "MNQ" }]);
    assert.deepEqual([plans.length, unmapped.map((u) => u.canonicalSymbol)], [1, ["MNQ"]]);
  });
  it("rejects ambiguous maps", () => {
    assert.throws(() => assertValidSymbolMap({ provider: "x", entries: { SPX: "A", MNQ: "A" } }), /maps to both/);
    assert.throws(() => assertValidSymbolMap({ provider: "x", entries: { "bad sym": "A" } }), /invalid canonical/);
  });
});

describe("session calendar", () => {
  it("is deterministic and explicit about sessions", () => {
    const cal = fixedSessionCalendar({ anchorOpen: 1_000_000, lengthMs: 100, periodMs: 1000, closedIndices: [1] });
    assert.deepEqual(cal.sessionAt(1_000_050), { openTimestamp: 1_000_000, closeTimestamp: 1_000_100 });
    assert.equal(cal.sessionAt(1_000_150), null, "outside regular hours");
    assert.equal(cal.sessionAt(1_001_050), null, "closed day");
    assert.deepEqual(cal.recentSessions(1_002_050, 2).map((w) => w.openTimestamp), [1_000_000, 1_002_000]);
    assert.throws(() => fixedSessionCalendar({ anchorOpen: 0, lengthMs: 0, periodMs: 1 }));
  });
});

describe("normalization + provenance", () => {
  it("good feed => canonical TradingSessions with DATA provenance; vendor symbols never reach candles", async () => {
    const f = await feed(providerFor(bullFeeds()), "SPX");
    assert.equal(f.ok, true);
    if (!f.ok) return;
    assert.equal(f.sessions.length, 25);
    assert.ok(f.sessions.every((s) => s.symbol === "SPX" && s.candles.every((c) => c.symbol === "SPX")));
    assert.deepEqual(
      { ...f.provenance, warnings: [] },
      { provider: "mock", providerSymbol: "I:SPX", canonicalSymbol: "SPX", role: "SPX", timeframe: "5m", fetchedAt: END, latestMarketTimestamp: END - M5, evidenceMode: "DATA", normalized: true, bars: f.provenance.bars, sessions: 25, warnings: [] },
    );
    assert.ok(Object.isFrozen(f.sessions[0]));
  });
  it("drops only the still-forming bar", async () => {
    const f = await feed(providerFor(bullFeeds()), "TSLA", END - 2 * 60_000);
    assert.equal(code(f), "OK");
    if (f.ok) {
      assert.equal(f.provenance.latestMarketTimestamp, END - 2 * M5);
      assert.ok(f.provenance.warnings.includes("still-forming bar excluded"));
    }
  });
  const defects: [MalformedDefect, string][] = [
    ["OUT_OF_ORDER", "OUT_OF_ORDER"],
    ["DUPLICATE", "DUPLICATE_BARS"],
    ["BAD_OHLC", "MALFORMED_BARS"],
    ["MISSING_BAR", "MISSING_BARS"],
    ["WRONG_SYMBOL", "INVALID_SYMBOL_MAPPING"],
    ["MISALIGNED", "SESSION_BOUNDARY"],
    ["FUTURE_BAR", "FUTURE_BAR"],
  ];
  for (const [defect, expected] of defects) {
    it(`malformed (${defect}) => ${expected} (fail closed, never repaired)`, async () => {
      assert.equal(code(await feed(new MalformedProvider(providerFor(bullFeeds()), defect))), expected);
    });
  }
  it("stale, outage, rate limit and unknown symbol fail closed", async () => {
    assert.equal(code(await feed(new StaleProvider(providerFor(bullFeeds()), 30 * 60_000))), "STALE_DATA");
    assert.equal(code(await feed(new FailingProvider("down"))), "PROVIDER_UNAVAILABLE");
    const rl = await feed(new FailingProvider("rl", "RATE_LIMITED", 5000));
    assert.equal(code(rl), "RATE_LIMITED");
    assert.equal(!rl.ok && rl.failure.retryAfterMs, 5000);
    assert.equal(code(await feed(new MockHistoricalProvider("empty", {}))), "INVALID_SYMBOL_MAPPING");
    assert.equal(code(await feed(new MockHistoricalProvider("none", { TSLA: [] }))), "MISSING_BARS");
  });
  it("a provider answering for another symbol is rejected", async () => {
    const liar: MarketDataProvider = {
      id: "liar",
      getHistoricalCandles: async () => ({ ok: true, value: [], providerSymbol: "NVDA", fetchedAt: END, warnings: [] }),
      getLatestCandles: async () => ({ ok: true, value: [] as Candle[], providerSymbol: "NVDA", fetchedAt: END, warnings: [] }),
    };
    assert.equal(code(await feed(liar)), "INVALID_SYMBOL_MAPPING");
  });
});

describe("provider labels never classify direction", () => {
  it("vendor-specific fields (signals, trend labels) are stripped before the engine", async () => {
    const base = providerFor(bullFeeds());
    const labelled: MarketDataProvider = {
      id: "labelled",
      getHistoricalCandles: async (r) => {
        const res = await base.getHistoricalCandles(r);
        return res.ok ? { ...res, value: res.value.map((c) => ({ ...c, signal: "PUT_SETUP", vendorTrend: "BEARISH" })) } : res;
      },
      getLatestCandles: async (r) => {
        const res = await base.getLatestCandles(r);
        return res.ok ? { ...res, value: res.value.map((c) => ({ ...c, signal: "PUT_SETUP", vendorTrend: "BEARISH" })) } : res;
      },
    };
    const f = await feed(labelled);
    assert.equal(f.ok, true);
    if (f.ok) for (const c of f.sessions.flatMap((s) => s.candles)) assert.deepEqual(Object.keys(c).sort(), ["close", "high", "low", "open", "symbol", "timeframe", "timestamp", "volume"]);
  });
});

describe("feed assembly (partial context, clock agreement)", () => {
  it("all roles on one clock => assembled DATA input", async () => {
    const p = providerFor(bullFeeds());
    const a = assembleFeeds([await feed(p, "TSLA"), await feed(p, "SPX"), await feed(p, "MNQ")]);
    assert.equal(a.ok, true);
    if (a.ok) {
      assert.equal(a.latestMarketTimestamp, END - M5);
      assert.deepEqual(a.provenance.map((x) => x.role), ["TARGET", "SPX", "MNQ"]);
    }
  });
  it("missing role => PARTIAL_MARKET_CONTEXT; disagreeing clocks => TIMESTAMP_DISAGREEMENT", async () => {
    const p = providerFor(bullFeeds());
    const partial = assembleFeeds([await feed(p, "TSLA"), await feed(p, "SPX")]);
    assert.deepEqual(!partial.ok && partial.failures.map((f) => f.code), ["PARTIAL_MARKET_CONTEXT"]);
    const late = await feed(new StaleProvider(p, 0), "MNQ", END - M5);
    const skew = assembleFeeds([await feed(p, "TSLA"), await feed(p, "SPX"), late]);
    assert.deepEqual(!skew.ok && skew.failures.map((f) => f.code), ["TIMESTAMP_DISAGREEMENT"]);
  });
  it("a failed optional volume proxy is dropped with a warning, never fatal", async () => {
    const p = providerFor(bullFeeds());
    const proxy: NormalizedFeed = { ok: false, role: "VOLUME_PROXY", failure: { code: "PROVIDER_UNAVAILABLE", message: "down" } };
    const a = assembleFeeds([await feed(p, "TSLA"), await feed(p, "SPX"), await feed(p, "MNQ"), proxy]);
    assert.equal(a.ok, true);
    assert.ok(a.ok && a.warnings[0]?.startsWith("volume proxy dropped"));
  });
  it("failures map to WAIT (rate limit only) or BLOCKED — never a setup", () => {
    assert.equal(providerFailurePermission([{ code: "RATE_LIMITED", message: "" }]), "WAIT");
    assert.equal(providerFailurePermission([{ code: "RATE_LIMITED", message: "" }, { code: "STALE_DATA", message: "" }]), "BLOCKED");
    for (const c of ["PROVIDER_UNAVAILABLE", "STALE_DATA", "MISSING_BARS", "OUT_OF_ORDER", "INVALID_SYMBOL_MAPPING", "TIMESTAMP_DISAGREEMENT", "PARTIAL_MARKET_CONTEXT"] as const) {
      assert.equal(providerFailurePermission([{ code: c, message: "" }]), "BLOCKED", c);
    }
  });
});
