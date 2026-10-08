import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONSERVATIVE_EXECUTION } from "../backtest/backtest.ts";
import { replayInput } from "../replay/replay-test-fixtures.ts";
import { DEFAULT_SETUP_POLICY } from "../triggers/setup-policy.ts";
import { assertNoHoldout, calibrationView, costSensitivity, decisionAnalytics, HoldoutViolation, outOfSampleReport, partitionOf, replayDays, scaleCosts, sealHoldout } from "./empirical.ts";

/** SYNTHETIC fixture: exercises the harness only; every report must say so. */
const ds = { name: "synthetic-bull", kind: "SYNTHETIC" as const, input: replayInput(), historySessions: 20 };
const days = replayDays([ds]);
const seal = sealHoldout(days.map((d) => d.day), 1);

describe("empirical decision analytics (Batch 65)", () => {
  const a = decisionAnalytics(days);
  it("counts every decision once, by ticker / timeframe / regime", () => {
    const total = Object.values(a.decisions).reduce((x, y) => x + y, 0);
    assert.equal(total, a.frames);
    for (const bucket of [a.byTicker, a.byTimeframe, a.byRegime]) assert.equal(Object.values(bucket).flatMap((c) => Object.values(c)).reduce((x, y) => x + y, 0), a.frames);
    assert.deepEqual(Object.keys(a.byTicker), ["TSLA"]);
  });
  it("transitions, regime alignment, invalidation distance and risk vetoes are reported", () => {
    assert.ok(Object.keys(a.transitions).every((k) => /^[A-Z_]+->[A-Z_]+$/.test(k) && k.split("->")[0] !== k.split("->")[1]));
    for (const r of Object.values(a.regimeAlignment)) assert.ok(r.aligned <= r.setupFrames);
    assert.ok(a.invalidation.invalidated <= a.invalidation.setups);
    assert.ok(a.invalidation.stopDistanceAtr.every((x) => x > 0));
    assert.equal(a.vetoes.blocked, a.decisions.BLOCKED);
  });
  it("deterministic and frozen", () => {
    assert.deepEqual(decisionAnalytics(replayDays([ds])), a);
    assert.ok(Object.isFrozen(a));
  });
});

describe("sealed chronological holdout (Batch 66)", () => {
  it("partitions are chronological, disjoint and hashed", () => {
    assert.deepEqual(seal.days.map((d) => partitionOf(seal, d)), ["TRAIN", "TRAIN", "TRAIN", "VALIDATION", "HOLDOUT"]);
    assert.ok(seal.trainEnd < seal.validationEnd && seal.validationEnd < seal.holdoutStart);
    assert.match(seal.sealHash, /^[0-9a-f]{64}$/);
    assert.equal(sealHoldout([...seal.days].reverse(), 2).sealHash, seal.sealHash, "order-independent definition");
    assert.throws(() => sealHoldout([1, 2], 0), RangeError);
    assert.throws(() => sealHoldout([1, 1, 2, 3, 4], 0), /duplicate/);
  });
  it("calibration never sees holdout sessions (truncated view; leaks throw)", () => {
    const view = calibrationView(ds, seal);
    assert.ok(view.input.target.every((s) => s.openTimestamp < seal.holdoutStart));
    assert.ok(view.input.spx.every((s) => s.openTimestamp < seal.holdoutStart));
    assert.doesNotThrow(() => assertNoHoldout(replayDays([view]), seal));
    assert.throws(() => assertNoHoldout(days, seal), HoldoutViolation);
    assert.throws(() => calibrationView({ ...ds, historySessions: 24 }, seal), HoldoutViolation);
  });
});

describe("cost sensitivity + out-of-sample report (Batch 66)", () => {
  const before = JSON.stringify(DEFAULT_SETUP_POLICY);
  const r = outOfSampleReport(days, seal);
  it("0x / 1x / 2x costs: higher costs never improve expectancy", () => {
    const rows = costSensitivity(days, seal);
    assert.deepEqual(rows.map((x) => x.multiplier), [0, 1, 2]);
    assert.deepEqual(rows[0]!.execution, scaleCosts(CONSERVATIVE_EXECUTION, 0));
    const e = rows.map((x) => x.overall.expectancyR);
    if (e.every((x) => x !== null)) assert.ok(e[0]! >= e[1]! && e[1]! >= e[2]!);
    assert.ok(rows.every((x) => x.overall.trades === rows[0]!.overall.trades), "costs change outcomes, not which setups trade");
  });
  it("is labelled synthetic, claims nothing, separates options, and is reproducible", () => {
    assert.equal(r.evidence, "SYNTHETIC_NOT_EMPIRICAL");
    assert.equal(r.performanceClaim, "NONE");
    assert.equal(r.significance.status, "NOT_ASSESSED");
    assert.equal(r.options.status, "NOT_EVALUATED");
    assert.equal(r.uncertainty.holdoutInsufficient, true);
    assert.match(r.disclaimer, /SYNTHETIC data — not empirical evidence/);
    assert.match(r.disclaimer, /No profitability or statistical significance is claimed/);
    assert.equal(r.partitions.TRAIN.days + r.partitions.VALIDATION.days + r.partitions.HOLDOUT.days, days.length);
    assert.equal(outOfSampleReport(days, seal).reportHash, r.reportHash);
    assert.equal(JSON.stringify(DEFAULT_SETUP_POLICY), before, "thresholds unchanged");
  });
  it("days outside the sealed partition are rejected", () => {
    const other = sealHoldout([1, 2, 3, 4, 5], 0);
    assert.throws(() => outOfSampleReport(days, other), HoldoutViolation);
  });
});
