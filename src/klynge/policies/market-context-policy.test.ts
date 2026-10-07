import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateMarketTruth } from "../engine/market-truth.ts";
import { buildTechnicalState } from "../engine/technical-state.ts";
import { makeSession, nowAfter } from "../test-fixtures.ts";
import { assertValidMarketContextPolicy, DEFAULT_MARKET_CONTEXT_POLICY, marketContextSources } from "./market-context-policy.ts";

const spx = (o = {}) => makeSession({ symbol: "SPX", trend: "up", ...o });
const mnq = (o = {}) => makeSession({ symbol: "MNQ", trend: "up", ...o });
const spy = (o = {}) => makeSession({ symbol: "SPY", trend: "up", base: 50, ...o });
const now = nowAfter(spx());

describe("market-context policy", () => {
  it("defaults: SPX price/structure, MNQ risk confirmation, SPY volume proxy", () => {
    assert.deepEqual({ ...DEFAULT_MARKET_CONTEXT_POLICY }, { broadMarketSymbol: "SPX", technologyConfirmationSymbol: "MNQ", volumeProxySymbol: "SPY" });
    assert.deepEqual(marketContextSources(DEFAULT_MARKET_CONTEXT_POLICY), [
      { symbol: "SPX", role: "PRICE_STRUCTURE" },
      { symbol: "MNQ", role: "RISK_CONFIRMATION" },
      { symbol: "SPY", role: "VOLUME_PROXY" },
    ]);
  });
  it("no proxy role when volumeProxySymbol is null", () => {
    assert.equal(marketContextSources({ ...DEFAULT_MARKET_CONTEXT_POLICY, volumeProxySymbol: null }).length, 2);
  });
  it("rejects empty or duplicate role symbols", () => {
    assert.throws(() => assertValidMarketContextPolicy({ ...DEFAULT_MARKET_CONTEXT_POLICY, broadMarketSymbol: "" }), RangeError);
    assert.throws(() => assertValidMarketContextPolicy({ ...DEFAULT_MARKET_CONTEXT_POLICY, volumeProxySymbol: "SPX" }), RangeError);
  });
});

describe("role enforcement in market truth", () => {
  it("SPY cannot silently replace SPX as PRICE_STRUCTURE", () => {
    const s = evaluateMarketTruth({ spx: makeSession({ symbol: "SPY", trend: "up" }), mnq: mnq(), now });
    assert.equal(s.technical.spx, null);
    assert.equal(s.permission.permission, "BLOCKED");
    assert.ok(s.permission.blockers.includes("MIXED_SERIES"));
  });
  it("wrong RISK_CONFIRMATION symbol is blocked", () => {
    assert.equal(evaluateMarketTruth({ spx: spx(), mnq: makeSession({ symbol: "NQ", trend: "up" }), now }).permission.permission, "BLOCKED");
  });
  it("configurable roles (ES as proxy, custom symbols)", () => {
    const contextPolicy = { broadMarketSymbol: "SPX", technologyConfirmationSymbol: "MNQ", volumeProxySymbol: "ES" };
    const s = evaluateMarketTruth({ spx: spx({ volume: 0 }), mnq: mnq(), volumeProxy: makeSession({ symbol: "ES", trend: "up" }), now, contextPolicy });
    assert.equal(s.permission.permission, "ENABLED");
    assert.deepEqual(s.marketContext.broadMarketVolumeSource, { symbol: "ES", role: "VOLUME_PROXY" });
  });
});

describe("SPX volume semantics", () => {
  it("zero-volume SPX without a proxy fails closed", () => {
    const s = evaluateMarketTruth({ spx: spx({ volume: 0 }), mnq: mnq(), now });
    assert.equal(s.permission.permission, "BLOCKED");
    assert.equal(s.regime.regime, "UNKNOWN");
  });
  it("zero-volume SPX + permitted SPY proxy => ENABLED, provenance records the proxy", () => {
    const s = evaluateMarketTruth({ spx: spx({ volume: 0 }), mnq: mnq(), volumeProxy: spy(), now });
    assert.equal(s.permission.permission, "ENABLED");
    assert.equal(s.technical.spx?.volumeSymbol, "SPY");
    assert.deepEqual(s.marketContext.broadMarketVolumeSource, { symbol: "SPY", role: "VOLUME_PROXY" });
  });
  it("without proxy, provenance records SPX as its own volume source", () => {
    assert.deepEqual(evaluateMarketTruth({ spx: spx(), mnq: mnq(), now }).marketContext.broadMarketVolumeSource, { symbol: "SPX", role: "PRICE_STRUCTURE" });
  });
  it("proxy never replaces SPX price, EMA, ATR, structure or direction inputs", () => {
    const native = buildTechnicalState(spx(), { now });
    const proxied = buildTechnicalState(spx({ volume: 0 }), { now, volumeProxy: spy({ volume: 777 }) });
    assert.ok(native.ok && proxied.ok);
    for (const k of ["symbol", "price", "ema9", "ema9Slope", "atr14", "structure", "timestamp"] as const) assert.equal(proxied.state[k], native.state[k], k);
    // Constant proxy volume => VWAP weights equal => identical VWAP to equal-volume native SPX.
    assert.equal(proxied.state.vwap, native.state.vwap);
    assert.equal(proxied.state.volume, 777);
  });
  it("proxy volume only reweights VWAP (still SPX typical prices)", () => {
    const vols = Array.from({ length: 30 }, (_, i) => (i < 15 ? 100 : 5000));
    const proxy = spy();
    const weighted = { ...proxy, candles: proxy.candles.map((c, i) => ({ ...c, volume: vols[i] as number })) };
    const r = buildTechnicalState(spx({ volume: 0 }), { now, volumeProxy: weighted });
    assert.ok(r.ok);
    const bars = spx().candles;
    const expected = bars.reduce((a, c, i) => a + ((c.high + c.low + c.close) / 3) * (vols[i] as number), 0) / vols.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(r.state.vwap - expected) < 1e-9);
  });
  it("proxy is rejected when the policy does not permit one", () => {
    const s = evaluateMarketTruth({ spx: spx(), mnq: mnq(), volumeProxy: spy(), now, contextPolicy: { ...DEFAULT_MARKET_CONTEXT_POLICY, volumeProxySymbol: null } });
    assert.equal(s.permission.permission, "BLOCKED");
    assert.ok(s.permission.blockers.includes("BAD_DATA"));
  });
  it("proxy with the wrong symbol is rejected", () => {
    const s = evaluateMarketTruth({ spx: spx(), mnq: mnq(), volumeProxy: makeSession({ symbol: "QQQ", trend: "up" }), now });
    assert.ok(s.permission.blockers.includes("MIXED_SERIES"));
  });
  it("misaligned proxy bars are rejected", () => {
    const s = evaluateMarketTruth({ spx: spx(), mnq: mnq(), volumeProxy: spy({ n: 29 }), now });
    assert.equal(s.permission.permission, "BLOCKED");
    assert.ok(s.permission.blockers.includes("MIXED_SERIES"));
  });
  it("bad proxy data blocks", () => {
    const p = spy();
    const bad = { ...p, candles: p.candles.map((c, i) => (i === 3 ? { ...c, volume: -1 } : c)) };
    assert.ok(evaluateMarketTruth({ spx: spx(), mnq: mnq(), volumeProxy: bad, now }).permission.blockers.includes("NEGATIVE_VOLUME"));
  });
});
