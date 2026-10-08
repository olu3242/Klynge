import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nyseCalendar } from "./engine-core.ts";
import { polygonMarketData } from "./market-data.ts";
import { PolygonProvider } from "./providers/polygon.ts";
import { ResilientProvider } from "./providers/resilient.ts";
import { assertNoSubstitution, RoutedProvider } from "./providers/routing.ts";
import { testDeps, USER_A } from "./test-support.ts";
import { connectData } from "./workspace.ts";

/** SYNTHETIC responses shaped like the documented aggregates API — contract tests only, not market data. */
type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response>;
function fakeFetch(handler: Handler) {
  const calls: { url: URL; auth: string | null }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, auth: new Headers(init?.headers).get("authorization") });
    return handler(url, init);
  }) as typeof fetch;
  return { f, calls };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const req = { canonicalSymbol: "TSLA", providerSymbol: "TSLA", timeframe: "5m" as const, from: 1_000_000, to: 2_000_000 };
const KEY = "test-key-not-real";

describe("Polygon/Massive adapter contract", () => {
  it("requests the aggregates range with Bearer auth (key never in the URL) and maps bars", async () => {
    const { f, calls } = fakeFetch(() => json({ status: "OK", ticker: "TSLA", results: [{ t: 1_000_000, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }] }));
    const r = await new PolygonProvider({ apiKey: KEY, fetch: f, clock: () => 5 }).getHistoricalCandles(req);
    assert.equal(r.ok, true);
    assert.equal(calls[0]!.url.pathname, "/v2/aggs/ticker/TSLA/range/5/minute/1000000/1999999");
    assert.equal(calls[0]!.url.searchParams.get("sort"), "asc");
    assert.equal(calls[0]!.auth, `Bearer ${KEY}`);
    assert.ok(!calls[0]!.url.toString().includes(KEY));
    assert.deepEqual(r.ok && r.value, [{ symbol: "TSLA", timeframe: "5m", timestamp: 1_000_000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }]);
    assert.equal(r.ok && r.raw?.length, 1, "raw vendor payload kept for ingestion");
  });
  it("follows next_url pagination on the same host only", async () => {
    let page = 0;
    const { f } = fakeFetch(() => json(page++ === 0 ? { status: "OK", ticker: "TSLA", results: [{ t: 1, o: 1, h: 1, l: 1, c: 1, v: 1 }], next_url: "https://api.polygon.io/v2/aggs/next?cursor=2" } : { status: "OK", ticker: "TSLA", results: [{ t: 2, o: 1, h: 1, l: 1, c: 1, v: 1 }] }));
    const r = await new PolygonProvider({ apiKey: KEY, fetch: f }).getHistoricalCandles(req);
    assert.deepEqual(r.ok && r.value.map((b) => b.timestamp), [1, 2]);
    const { f: evil } = fakeFetch(() => json({ status: "OK", ticker: "TSLA", results: [], next_url: "https://evil.example/steal" }));
    const e = await new PolygonProvider({ apiKey: KEY, fetch: evil }).getHistoricalCandles(req);
    assert.equal(!e.ok && e.failure.code, "PROVIDER_UNAVAILABLE");
  });
  it("index bars without volume map to 0 with a volume-proxy warning", async () => {
    const { f } = fakeFetch(() => json({ status: "OK", ticker: "I:SPX", results: [{ t: 1, o: 5000, h: 5001, l: 4999, c: 5000 }] }));
    const r = await new PolygonProvider({ apiKey: KEY, fetch: f }).getHistoricalCandles({ ...req, canonicalSymbol: "SPX", providerSymbol: "I:SPX" });
    assert.equal(r.ok && r.value[0]!.volume, 0);
    assert.ok(r.ok && r.warnings.some((w) => /volume proxy/.test(w)));
  });
  for (const [status, body, code] of [
    [429, { status: "ERROR" }, "RATE_LIMITED"],
    [403, { status: "NOT_AUTHORIZED" }, "ENTITLEMENT_MISSING"],
    [401, {}, "ENTITLEMENT_MISSING"],
    [404, {}, "INVALID_SYMBOL_MAPPING"],
    [503, {}, "PROVIDER_UNAVAILABLE"],
  ] as const) {
    it(`HTTP ${status} => ${code}`, async () => {
      const { f } = fakeFetch(() => json(body, status, status === 429 ? { "retry-after": "12" } : {}));
      const r = await new PolygonProvider({ apiKey: KEY, fetch: f }).getHistoricalCandles(req);
      assert.equal(!r.ok && r.failure.code, code);
      if (status === 429) assert.equal(!r.ok && r.failure.retryAfterMs, 12_000);
    });
  }
  it("malformed JSON, vendor ERROR status and ticker mismatch fail closed", async () => {
    for (const [res, code] of [
      [new Response("<html>", { status: 200 }), "MALFORMED_BARS"],
      [json({ status: "ERROR" }), "PROVIDER_UNAVAILABLE"],
      [json({ status: "OK", ticker: "TSLAX", results: [] }), "INVALID_SYMBOL_MAPPING"],
    ] as const) {
      const { f } = fakeFetch(() => res.clone());
      const r = await new PolygonProvider({ apiKey: KEY, fetch: f }).getHistoricalCandles(req);
      assert.equal(!r.ok && r.failure.code, code);
    }
  });
});

describe("resilience: retries, rate limits, health", () => {
  it("retries transient failures with backoff (honouring Retry-After) and recovers", async () => {
    let n = 0;
    const sleeps: number[] = [];
    const { f } = fakeFetch(() => (n++ < 2 ? json({}, n === 1 ? 503 : 429, n === 2 ? { "retry-after": "3" } : {}) : json({ status: "OK", ticker: "TSLA", results: [] })));
    const p = new ResilientProvider(new PolygonProvider({ apiKey: KEY, fetch: f }), { maxRetries: 3, baseDelayMs: 100, sleep: async (ms) => void sleeps.push(ms), capacity: 100 });
    assert.equal((await p.getHistoricalCandles(req)).ok, true);
    assert.deepEqual(sleeps, [100, 3000]);
    assert.deepEqual([p.health().status, p.health().retries, p.health().consecutiveFailures], ["HEALTHY", 2, 0]);
  });
  it("never retries entitlement failures; gives up after bounded retries and reports DOWN", async () => {
    let calls = 0;
    const { f } = fakeFetch(() => (calls++, json({}, 403)));
    const p = new ResilientProvider(new PolygonProvider({ apiKey: KEY, fetch: f }), { sleep: async () => undefined, capacity: 100 });
    assert.equal(((await p.getHistoricalCandles(req)) as { failure: { code: string } }).failure.code, "ENTITLEMENT_MISSING");
    assert.equal(calls, 1);
    const { f: down } = fakeFetch(() => json({}, 503));
    const q = new ResilientProvider(new PolygonProvider({ apiKey: KEY, fetch: down }), { maxRetries: 1, sleep: async () => undefined, capacity: 100 });
    for (let i = 0; i < 3; i++) await q.getHistoricalCandles(req);
    assert.equal(q.health().status, "DOWN");
  });
  it("client-side token bucket refuses bursts beyond the plan instead of hammering the vendor", async () => {
    const now = 0;
    const { f, calls } = fakeFetch(() => json({ status: "OK", ticker: "TSLA", results: [] }));
    const p = new ResilientProvider(new PolygonProvider({ apiKey: KEY, fetch: f }), { capacity: 2, refillPerMs: 1 / 60_000, maxDelayMs: 1000, clock: () => now, sleep: async () => undefined });
    await p.getHistoricalCandles(req);
    await p.getHistoricalCandles(req);
    const r = await p.getHistoricalCandles(req);
    assert.equal(!r.ok && r.failure.code, "RATE_LIMITED");
    assert.equal(calls.length, 2);
  });
});

describe("entitlements: no silent substitution", () => {
  it("SPY can never serve SPX; NQ can never serve MNQ", () => {
    assert.throws(() => assertNoSubstitution({ provider: "x", entries: { SPX: "SPY" } }), /substitution forbidden/);
    assert.throws(() => assertNoSubstitution({ provider: "x", entries: { MNQ: "NQ1!" } }), /substitution forbidden/);
    const dummy = new PolygonProvider({ apiKey: KEY, fetch: fakeFetch(() => json({})).f });
    assert.throws(() => new RoutedProvider("r", [{ provider: dummy, entitlements: [{ canonicalSymbol: "SPX", providerSymbol: "SPY", timeframes: ["5m"], assetClass: "etf" }] }]), /may not be served/);
  });
  it("unlicensed instruments fail as ENTITLEMENT_MISSING; licensed ones route", async () => {
    const { f } = fakeFetch((u) => json({ status: "OK", ticker: decodeURIComponent(u.pathname.split("/")[4]!), results: [] }));
    const routed = new RoutedProvider("r", [{ provider: new PolygonProvider({ apiKey: KEY, fetch: f }), entitlements: [{ canonicalSymbol: "SPX", providerSymbol: "I:SPX", timeframes: ["5m"], assetClass: "index" }], equityPassThrough: ["5m"] }]);
    assert.equal((await routed.getHistoricalCandles({ ...req, providerSymbol: "I:SPX" })).ok, true);
    assert.equal((await routed.getHistoricalCandles(req)).ok, true, "equity pass-through");
    const mnq = await routed.getHistoricalCandles({ ...req, canonicalSymbol: "MNQ", providerSymbol: "CME:MNQ" });
    assert.equal(!mnq.ok && mnq.failure.code, "ENTITLEMENT_MISSING");
    const wrongTf = await routed.getHistoricalCandles({ ...req, providerSymbol: "I:SPX", timeframe: "1m" });
    assert.equal(!wrongTf.ok && wrongTf.failure.code, "ENTITLEMENT_MISSING");
  });
});

describe("configured Polygon setup → DATA runtime (offline)", () => {
  it("without a CME futures source, DATA mode is BLOCKED (MNQ unlicensed) — never NQ, never SPY-as-SPX", async () => {
    const cal = nyseCalendar();
    const bars = (ticker: string, from: number, to: number) => {
      const out = [];
      for (const w of cal.sessionsBetween(from, to)) for (let t = w.openTimestamp; t < w.closeTimestamp && t < to; t += 300_000) if (t >= from) out.push({ t, o: 100, h: 101, l: 99, c: 100, v: ticker === "I:SPX" ? undefined : 10 });
      return out;
    };
    const { f, calls } = fakeFetch((u) => {
      const [, , , , ticker, , , , from, to] = u.pathname.split("/");
      const t = decodeURIComponent(ticker!);
      return json({ status: "OK", ticker: t, results: bars(t, Number(from), Number(to) + 1) });
    });
    const market = polygonMarketData({ POLYGON_API_KEY: KEY, KLYNGE_POLYGON_PLANS: "stocks,indices" }, f);
    const deps = { ...testDeps(), market };
    const v = await connectData(deps, { tenantId: USER_A, sessionId: "s-poly", symbol: "TSLA", now: Date.parse("2026-10-07T17:00:00Z") });
    assert.equal(v.runtime?.status, "BLOCKED");
    assert.ok(v.runtime?.reasons.some((r) => /does not license/.test(r)), JSON.stringify(v.runtime));
    assert.equal(v.data, null);
    assert.ok(!calls.some((c) => /\/NQ|\/QQQ|\/SPY\//.test(c.url.pathname)), "no substitute tickers requested");
    assert.equal(market.health!()[0]!.provider, "polygon");
    assert.throws(() => polygonMarketData({}), /POLYGON_API_KEY/);
  });
});
