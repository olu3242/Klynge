import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PriceLevel } from "../levels/types.ts";
import { DEFAULT_RISK_POLICY, entryZone, evaluateRisk } from "./risk-engine.ts";
import type { RiskInput } from "./risk-engine.ts";

const lvl = (id: string, price: number, confirmed = true): PriceLevel => ({ id, symbol: "X", timeframe: "5m", price, type: "RESISTANCE", strength: "VALID", touches: 2, confirmed, createdAt: 1, source: "t" });
// ATR 4 => zone [100, 101], entry 100.5; invalidation 99.5 => stop 1 (0.25 ATR).
const base: RiskInput = { side: "BULLISH", level: lvl("L", 100), invalidation: 99.5, levels: [lvl("L", 100), lvl("T", 103)], currentPrice: 100.75, atr14: 4 };

describe("risk engine", () => {
  it("valid setup => allowed with exact R:R", () => {
    const r = evaluateRisk(base);
    assert.equal(r.allowed, true);
    assert.deepEqual(r.entryZone, { min: 100, max: 101 });
    assert.equal(r.stopDistance, 1);
    assert.equal(r.target, 103);
    assert.equal(r.rewardRiskRatio, 2.5);
    assert.equal(r.level, "LOW");
  });
  it("no invalidation => BLOCKED", () => {
    const { invalidation: _omit, ...noInv } = base;
    void _omit;
    const r = evaluateRisk(noInv);
    assert.equal(r.level, "BLOCKED");
    assert.deepEqual(r.blockers, ["NO_INVALIDATION"]);
  });
  it("invalidation on the wrong side => BLOCKED", () => assert.ok(evaluateRisk({ ...base, invalidation: 100.2 }).blockers.includes("NO_INVALIDATION")));
  it("no target => BLOCKED (never fabricated)", () => {
    const r = evaluateRisk({ ...base, levels: [lvl("L", 100)] });
    assert.ok(r.blockers.includes("NO_TARGET"));
    assert.equal(r.target, undefined);
  });
  it("unconfirmed or already-broken levels are not targets", () => {
    assert.ok(evaluateRisk({ ...base, levels: [lvl("T", 103, false)] }).blockers.includes("NO_TARGET"));
    assert.ok(evaluateRisk({ ...base, brokenLevelIds: new Set(["T"]) }).blockers.includes("NO_TARGET"));
  });
  it("nearest target beyond the zone is used", () => assert.equal(evaluateRisk({ ...base, levels: [lvl("A", 105), lvl("B", 103), lvl("C", 100.9)] }).target, 103));
  it("R:R below policy => BLOCKED with explicit reason", () => {
    const r = evaluateRisk({ ...base, levels: [lvl("T", 102)] }); // reward 1.5 / risk 1
    assert.equal(r.allowed, false);
    assert.deepEqual(r.blockers, ["INSUFFICIENT_REWARD_RISK"]);
    assert.deepEqual(r.reasons, ["Insufficient reward relative to structural risk"]);
  });
  it("R:R exactly at the minimum is allowed", () => assert.equal(evaluateRisk({ ...base, levels: [lvl("T", 102.5)] }).allowed, true));
  it("stop too wide relative to ATR => BLOCKED", () => {
    const r = evaluateRisk({ ...base, invalidation: 94, levels: [lvl("T", 200)] }); // stop 6.5 = 1.625 ATR
    assert.ok(r.blockers.includes("STOP_TOO_WIDE"));
  });
  it("price extended beyond the entry zone => BLOCKED", () => assert.ok(evaluateRisk({ ...base, currentPrice: 105.5 }).blockers.includes("PRICE_EXTENDED")));
  it("invalid ATR => BLOCKED", () => assert.ok(evaluateRisk({ ...base, atr14: 0 }).blockers.includes("INVALID_ATR")));
  it("bearish mirror", () => {
    const r = evaluateRisk({ side: "BEARISH", level: lvl("L", 100), invalidation: 100.5, levels: [lvl("T", 97)], currentPrice: 99.25, atr14: 4 });
    assert.deepEqual(r.entryZone, { min: 99, max: 100 });
    assert.equal(r.rewardRiskRatio, 2.5);
    assert.equal(r.allowed, true);
  });
  it("entry zone derives from level + ATR tolerance", () => {
    assert.deepEqual(entryZone("BULLISH", 100, 2, DEFAULT_RISK_POLICY), { min: 100, max: 100.5 });
  });
  it("risk levels scale with stop/ATR", () => {
    assert.equal(evaluateRisk({ ...base, invalidation: 97.5, levels: [lvl("T", 110)] }).level, "MODERATE"); // 3/4 = 0.75 ATR
  });
  it("rejects invalid policy", () => assert.throws(() => evaluateRisk({ ...base, policy: { ...DEFAULT_RISK_POLICY, maximumStopAtr: 0 } }), RangeError));
});
