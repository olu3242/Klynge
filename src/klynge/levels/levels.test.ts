import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SwingPoint } from "../domain/types.ts";
import { BULL_BARS, barsToCandles, PRIOR_OPEN, priorBars, sessionOf } from "../setup-test-fixtures.ts";
import { FIVE_MIN } from "../test-fixtures.ts";
import { clusterSwings } from "./clustering.ts";
import { discoverLevels, isTradableBreakLevel } from "./discover-levels.ts";
import { canonicalPrice, levelId } from "./level-id.ts";
import { assertValidLevelPolicy, DEFAULT_LEVEL_POLICY, RESISTANCE_TYPES, SUPPORT_TYPES } from "./types.ts";

const session = sessionOf("TSLA", barsToCandles("TSLA", BULL_BARS));
const prior = sessionOf("TSLA", barsToCandles("TSLA", priorBars(104, 97), PRIOR_OPEN), PRIOR_OPEN, PRIOR_OPEN + 30 * FIVE_MIN);
const levels = discoverLevels({ session, priorSession: prior });
const of = (type: string) => levels.filter((l) => l.type === type);

describe("level discovery", () => {
  it("prior session high / low (confirmed at prior close, VALID)", () => {
    const [hi] = of("PRIOR_SESSION_HIGH");
    const [lo] = of("PRIOR_SESSION_LOW");
    assert.equal(hi?.price, 104);
    assert.equal(lo?.price, 97);
    assert.equal(hi?.confirmed, true);
    assert.equal(hi?.confirmedAt, prior.closeTimestamp);
    assert.equal(hi?.strength, "VALID");
  });
  it("current session high / low are dynamic (unconfirmed, WEAK)", () => {
    assert.equal(of("SESSION_HIGH")[0]?.price, 102.6);
    assert.equal(of("SESSION_LOW")[0]?.price, 94.8);
    assert.equal(of("SESSION_HIGH")[0]?.confirmed, false);
  });
  it("confirmed swing highs / lows", () => {
    assert.deepEqual(of("SWING_HIGH").map((l) => l.price), [102, 102.05]);
    assert.deepEqual(of("SWING_LOW").map((l) => l.price), [100.4, 100.9]);
    assert.ok(of("SWING_HIGH").every((l) => l.confirmed && l.strength === "WEAK" && l.touches === 1));
  });
  it("repeated resistance from clustered swing highs", () => {
    const [r] = of("RESISTANCE");
    assert.ok(r);
    assert.equal(r.price, (102 + 102.05) / 2);
    assert.equal(r.touches, 2);
    assert.equal(r.strength, "VALID");
    assert.equal(r.confirmedAt, session.candles[20]?.timestamp); // 2nd swing confirmed at index 18 + 2
    assert.ok(isTradableBreakLevel(r, RESISTANCE_TYPES));
    assert.equal(isTradableBreakLevel(r, SUPPORT_TYPES), false);
  });
  it("swing lows too far apart do not form support (insufficient touches within tolerance)", () => {
    assert.equal(of("SUPPORT").length, 0);
  });
  it("repeated support forms when lows cluster", () => {
    const swings: SwingPoint[] = [100, 100.1, 100.05].map((price, i) => ({ index: i * 5, timestamp: i, price, type: "LOW", confirmedAtIndex: i * 5 + 2, confirmedAtTimestamp: i + 2 }));
    const [c] = clusterSwings(swings, 0.1, 2);
    assert.equal(c?.members.length, 3);
    assert.ok(Math.abs((c?.price ?? 0) - 100.05) < 1e-12);
  });
  it("session VWAP level", () => assert.equal(of("VWAP").length, 1));
  it("only confirmed, non-WEAK levels are tradable", () => {
    for (const l of levels) if (isTradableBreakLevel(l, [...RESISTANCE_TYPES, ...SUPPORT_TYPES])) assert.ok(l.confirmed && l.strength !== "WEAK");
  });
  it("as-of discovery has no lookahead", () => {
    const early = discoverLevels({ session, asOfIndex: 19 });
    assert.equal(early.filter((l) => l.type === "RESISTANCE").length, 0); // 2nd swing not confirmed until index 20
    assert.equal(discoverLevels({ session, asOfIndex: 20 }).filter((l) => l.type === "RESISTANCE").length, 1);
    assert.ok(discoverLevels({ session, asOfIndex: 10 }).every((l) => l.createdAt <= (session.candles[10]?.timestamp ?? 0)));
  });
  it("is deterministic with stable ordering", () => {
    assert.deepEqual(discoverLevels({ session, priorSession: prior }), levels);
    for (let i = 1; i < levels.length; i++) assert.ok((levels[i - 1]?.price ?? 0) <= (levels[i]?.price ?? 0));
  });
});

describe("ATR clustering", () => {
  const sw = (prices: number[]): SwingPoint[] => prices.map((price, i) => ({ index: i, timestamp: i, price, type: "HIGH", confirmedAtIndex: i + 2, confirmedAtTimestamp: i + 2 }));
  it("joins swings within 2 × tolerance span (boundary inclusive)", () => {
    assert.equal(clusterSwings(sw([100, 100.5]), 0.25, 2).length, 1);
    assert.equal(clusterSwings(sw([100, 100.5000001]), 0.25, 2).length, 0);
  });
  it("tolerance scales with ATR multiplier", () => {
    assert.equal(clusterSwings(sw([100, 101]), 0.25, 2).length, 0);
    assert.equal(clusterSwings(sw([100, 101]), 0.5, 2).length, 1);
  });
  it("insufficient touches => no level", () => assert.equal(clusterSwings(sw([100]), 1, 2).length, 0));
  it("minimumTouches is configurable; extra touches => STRONG", () => {
    const s = sessionOf("X", barsToCandles("X", BULL_BARS));
    assert.equal(discoverLevels({ session: s, policy: { ...DEFAULT_LEVEL_POLICY, minimumTouches: 3 } }).filter((l) => l.type === "RESISTANCE").length, 0);
    assert.equal(clusterSwings(sw([100, 100.1, 100.2]), 0.25, 2)[0]?.members.length, 3);
  });
  it("rejects invalid policy", () => {
    assert.throws(() => assertValidLevelPolicy({ minimumTouches: 1, atrToleranceMultiplier: 0.25 }), RangeError);
    assert.throws(() => assertValidLevelPolicy({ minimumTouches: 2, atrToleranceMultiplier: -1 }), RangeError);
  });
});

describe("deterministic level ids", () => {
  it("SYMBOL:TF:TYPE:PRICE:CREATED_AT", () => {
    assert.equal(levelId("TSLA", "5m", "SWING_HIGH", 241.35, 1720000000), "TSLA:5m:SWING_HIGH:241.35:1720000000");
    assert.equal(canonicalPrice(102.025000000001), "102.025");
  });
  it("ids are unique within a discovery and contain no random component", () => {
    const ids = levels.map((l) => l.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const l of levels) assert.equal(l.id, levelId(l.symbol, l.timeframe, l.type, l.price, l.createdAt));
  });
});
