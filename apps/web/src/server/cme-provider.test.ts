import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cmeEquityIndexCalendar, nyseCalendar } from "./engine-core.ts";
import type { Candle } from "./engine-core.ts";
import { polygonMarketData } from "./market-data.ts";
import { CmeFuturesProvider, MockFuturesBarsSource } from "./providers/cme-futures.ts";
import { DatabentoBarsSource } from "./providers/databento.ts";
import { testDeps, USER_A } from "./test-support.ts";
import { connectData } from "./workspace.ts";

/** SYNTHETIC vendor-shaped responses (contract tests only). */
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
const cme = cmeEquityIndexCalendar();
const KEY = "db-test-key-not-real";

describe("Databento (CME Globex) source contract", () => {
  it("requests GLBX.MDP3 ohlcv-1m for the exact contract with Basic auth; parses NDJSON", async () => {
    const seen: URL[] = [];
    let auth = "";
    const f = (async (u: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new URL(String(u)));
      auth = new Headers(init?.headers).get("authorization") ?? "";
      return json(['{"hd":{"ts_event":"2026-10-12T14:30:00.000000000Z"},"symbol":"MNQZ6","open":"25000.250000000","high":"25001.000000000","low":"24999.500000000","close":"25000.750000000","volume":"42"}', ""].join("\n"));
    }) as typeof fetch;
    const src = new DatabentoBarsSource({ apiKey: KEY, licensedDatasets: ["GLBX.MDP3"], fetch: f, clock: () => 9 });
    const r = await src.fetchMinuteBars("MNQZ6", Date.parse("2026-10-12T14:00:00Z"), Date.parse("2026-10-12T15:00:00Z"));
    const q = seen[0]!.searchParams;
    assert.deepEqual([seen[0]!.pathname, q.get("dataset"), q.get("schema"), q.get("symbols"), q.get("stype_in"), q.get("encoding")], ["/v0/timeseries.get_range", "GLBX.MDP3", "ohlcv-1m", "MNQZ6", "raw_symbol", "json"]);
    assert.equal(auth, `Basic ${Buffer.from(`${KEY}:`).toString("base64")}`);
    assert.ok(!seen[0]!.toString().includes(KEY));
    assert.deepEqual(r.ok && r.value, [{ symbol: "MNQZ6", timeframe: "1m", timestamp: Date.parse("2026-10-12T14:30:00Z"), open: 25000.25, high: 25001, low: 24999.5, close: 25000.75, volume: 42 }]);
  });
  for (const [status, code] of [[401, "ENTITLEMENT_MISSING"], [403, "ENTITLEMENT_MISSING"], [422, "INVALID_SYMBOL_MAPPING"], [429, "RATE_LIMITED"], [502, "PROVIDER_UNAVAILABLE"]] as const) {
    it(`HTTP ${status} => ${code}`, async () => {
      const src = new DatabentoBarsSource({ apiKey: KEY, licensedDatasets: ["GLBX.MDP3"], fetch: (async () => json("{}", status, status === 429 ? { "retry-after": "4" } : {})) as typeof fetch });
      const r = await src.fetchMinuteBars("MNQZ6", 0, 1);
      assert.equal(!r.ok && r.failure.code, code);
    });
  }
  it("malformed records fail closed", async () => {
    const src = new DatabentoBarsSource({ apiKey: KEY, licensedDatasets: ["GLBX.MDP3"], fetch: (async () => json("{not json")) as typeof fetch });
    assert.equal(((await src.fetchMinuteBars("MNQZ6", 0, 1)) as { failure: { code: string } }).failure.code, "MALFORMED_BARS");
  });
});

describe("vendor-neutral CME futures provider (MNQ)", () => {
  const open = Date.parse("2026-10-11T22:00:00Z");
  const minute = (sym: string, n: number): Candle[] => Array.from({ length: n }, (_, i) => ({ symbol: sym, timeframe: "1m", timestamp: open + i * 60_000, open: 100, high: 101, low: 99, close: 100, volume: 3 }));
  const req = { canonicalSymbol: "MNQ", providerSymbol: "CME:MNQ", timeframe: "5m" as const, from: open, to: open + 30 * 60_000 };
  it("selects the front contract for the evaluation time, aggregates on the CME calendar, labels provenance", async () => {
    const src = new MockFuturesBarsSource({ MNQZ6: minute("MNQZ6", 30) });
    const r = await new CmeFuturesProvider({ source: src, calendar: cme, roots: { "CME:MNQ": "MNQ" } }).getHistoricalCandles(req);
    assert.equal(r.ok, true);
    assert.deepEqual(src.requests, ["MNQZ6"]);
    assert.equal(r.ok && r.value.length, 6);
    assert.ok(r.ok && r.value.every((b) => b.symbol === "CME:MNQ" && b.timeframe === "5m"));
    assert.ok(r.ok && r.warnings.some((w) => w.startsWith("front contract MNQZ6")));
  });
  it("rolls to the next quarterly contract after the roll date", async () => {
    const src = new MockFuturesBarsSource({});
    await new CmeFuturesProvider({ source: src, calendar: cme, roots: { "CME:MNQ": "MNQ" } }).getLatestCandles({ canonicalSymbol: "MNQ", providerSymbol: "CME:MNQ", timeframe: "5m", since: 0, now: Date.parse("2026-12-11T15:00:00Z") });
    assert.deepEqual(src.requests, ["MNQH7"]);
  });
  it("unlicensed dataset => ENTITLEMENT_MISSING before any vendor request; wrong contract => mapping failure", async () => {
    const unlicensed = new MockFuturesBarsSource({ MNQZ6: minute("MNQZ6", 10) }, []);
    const r = await new CmeFuturesProvider({ source: unlicensed, calendar: cme, roots: { "CME:MNQ": "MNQ" } }).getHistoricalCandles(req);
    assert.equal(!r.ok && r.failure.code, "ENTITLEMENT_MISSING");
    assert.deepEqual(unlicensed.requests, []);
    const liar = new MockFuturesBarsSource({ MNQZ6: minute("NQZ6", 10) });
    const l = await new CmeFuturesProvider({ source: liar, calendar: cme, roots: { "CME:MNQ": "MNQ" } }).getHistoricalCandles(req);
    assert.equal(!l.ok && l.failure.code, "INVALID_SYMBOL_MAPPING");
  });
  it("NQ can never be configured for MNQ", () => {
    assert.throws(() => new CmeFuturesProvider({ source: new MockFuturesBarsSource({}), calendar: cme, roots: { "CME:MNQ": "NQ" } }), /no substitution/);
  });
});

describe("Polygon (TSLA, SPX) + CME (MNQ) → DATA runtime (offline integration)", () => {
  it("with a licensed CME source, MNQ comes from the front contract and the runtime evaluates", async () => {
    const nyse = nyseCalendar();
    const now = Date.parse("2026-10-07T17:00:00Z");
    const eqBars = (from: number, to: number, withVolume: boolean) => {
      const out = [];
      for (const w of nyse.sessionsBetween(from, to)) for (let t = w.openTimestamp; t < w.closeTimestamp && t < to; t += 300_000) if (t >= from) out.push({ t, o: 100, h: 101, l: 99, c: 100, ...(withVolume ? { v: 10 } : {}) });
      return out;
    };
    const f = (async (u: RequestInfo | URL) => {
      const url = new URL(String(u));
      const parts = url.pathname.split("/");
      const ticker = decodeURIComponent(parts[4]!);
      return json({ status: "OK", ticker, results: eqBars(Number(parts[8]), Number(parts[9]) + 1, ticker !== "I:SPX") });
    }) as typeof fetch;
    const mnq: Candle[] = [];
    for (const w of cme.sessionsBetween(Date.parse("2026-08-01T00:00:00Z"), now)) for (let t = w.openTimestamp; t < w.closeTimestamp && t < now; t += 60_000) mnq.push({ symbol: "MNQZ6", timeframe: "1m", timestamp: t, open: 25000, high: 25001, low: 24999, close: 25000, volume: 5 });
    const market = polygonMarketData({ POLYGON_API_KEY: "test", KLYNGE_POLYGON_PLANS: "stocks,indices" }, f, new MockFuturesBarsSource({ MNQZ6: mnq }));
    assert.ok(market.entitlements!.some((e) => e.canonicalSymbol === "MNQ" && e.providerSymbol === "CME:MNQ"));
    const v = await connectData({ ...testDeps(), market }, { tenantId: USER_A, sessionId: "s-cme", symbol: "TSLA", now });
    assert.ok(!(v.runtime?.reasons ?? []).some((r) => /does not license/.test(r)), "MNQ is licensed through the CME source");
    assert.equal(v.runtime?.status, "DATA_VERIFIED", JSON.stringify(v.runtime));
    const mnqProv = v.data?.provenance.find((p) => p.role === "MNQ");
    assert.deepEqual([mnqProv?.canonicalSymbol, mnqProv?.providerSymbol], ["MNQ", "CME:MNQ"]);
    assert.ok(mnqProv?.warnings.some((w) => w.includes("front contract MNQZ6")));
    assert.equal(market.health!().length, 2);
  });
});
