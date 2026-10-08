import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateDecisionState } from "../triggers/invariants.ts";
import { FailingProvider, MalformedProvider, MockLiveProvider, StaleProvider, barsFromSessions } from "../providers/mock-providers.ts";
import { bullFeeds, config, END, M15, M5, mixedFeeds, providerFor } from "../providers/provider-test-fixtures.ts";
import { LiveDataRuntime, MemoryRuntimeStore, runDataCycle } from "./live-runtime.ts";
import type { CycleOutcome, RuntimeStore } from "./live-runtime.ts";

const evaluated = (o: CycleOutcome) => {
  assert.equal(o.kind, "EVALUATED", JSON.stringify(o).slice(0, 300));
  return o as Extract<CycleOutcome, { kind: "EVALUATED" }>;
};

describe("DATA runtime — good path", () => {
  it("provider → normalize → engine => CALL_SETUP with provenance, persisted, DATA_VERIFIED alert", async () => {
    const store = new MemoryRuntimeStore();
    const o = evaluated(await runDataCycle({ provider: providerFor(bullFeeds()), store }, config(), END));
    assert.equal(o.decision.decision, "CALL_SETUP");
    assert.equal(o.decision.evidenceMode, "DATA");
    assert.deepEqual(validateDecisionState(o.decision), []);
    assert.deepEqual(o.marketData.map((p) => [p.role, p.provider, p.providerSymbol, p.evidenceMode]), [["TARGET", "mock", "TSLA", "DATA"], ["SPX", "mock", "I:SPX", "DATA"], ["MNQ", "mock", "MNQ1!", "DATA"]]);
    assert.equal(o.marketTimestamp, END - M5);
    assert.equal(store.decisions.size, 1);
    assert.deepEqual(o.alerts.map((a) => a.event), ["DATA_VERIFIED", "CALL_SETUP", "OPTIONS_BLOCKED"]);
    assert.equal(o.previousRestored, false);
  });
  it("options stay downstream: evaluated after the setup, never alter it", async () => {
    const o = evaluated(await runDataCycle({ provider: providerFor(bullFeeds()), store: new MemoryRuntimeStore() }, config(), END));
    assert.equal(o.options.underlyingDecision, "CALL_SETUP");
    assert.notEqual(o.options.decision, "ELIGIBLE", "no chain => nothing eligible");
    assert.equal(o.decision.decision, "CALL_SETUP", "empty chain never downgrades the setup");
    const wait = evaluated(await runDataCycle({ provider: providerFor(bullFeeds()), store: new MemoryRuntimeStore() }, config(), END - 2 * M15));
    assert.equal(wait.decision.decision, "WAIT");
    assert.deepEqual(wait.options.blockers, ["NO_UNDERLYING_SETUP"]);
  });
});

describe("lifecycle memory, idempotency, restart", () => {
  it("previous decision is restored automatically (callers never pass it)", async () => {
    const store = new MemoryRuntimeStore();
    const first = evaluated(await runDataCycle({ provider: providerFor(bullFeeds()), store }, config(), END - 2 * M15));
    assert.equal(first.decision.decision, "WAIT");
    const second = evaluated(await runDataCycle({ provider: providerFor(bullFeeds()), store }, config(), END));
    assert.equal(second.previousRestored, true);
    assert.equal(second.decision.decision, "CALL_SETUP");
    assert.ok(second.alerts.some((a) => a.event === "CALL_SETUP" && a.from === "WAIT"));
  });
  it("revised market data chains the persisted CALL => INVALIDATED (never silently reversed)", async () => {
    const store = new MemoryRuntimeStore();
    evaluated(await runDataCycle({ provider: providerFor(bullFeeds()), store }, config(), END));
    const o = evaluated(await runDataCycle({ provider: providerFor(mixedFeeds()), store }, config(), END + 1000));
    assert.equal(o.decision.decision, "INVALIDATED");
    assert.ok(o.alerts.some((a) => a.event === "INVALIDATED" && a.severity === "WARNING"));
    assert.ok(o.alerts.some((a) => a.event === "MIXED"));
  });
  it("reprocessing the same market state => UNCHANGED, no duplicate decisions or alerts", async () => {
    const store = new MemoryRuntimeStore();
    const deps = { provider: providerFor(bullFeeds()), store };
    const a = evaluated(await runDataCycle(deps, config(), END));
    const b = await runDataCycle(deps, config(), END + 30_000);
    assert.equal(b.kind, "UNCHANGED");
    assert.equal(b.kind === "UNCHANGED" && b.recordId, a.recordId);
    assert.equal(store.decisions.size, 1);
    assert.equal(store.alerts.size, 3);
  });
  it("restart: a new runtime over the same durable store resumes instead of starting blank", async () => {
    const store = new MemoryRuntimeStore();
    const a = evaluated(await runDataCycle({ provider: providerFor(bullFeeds()), store }, config(), END));
    const restarted: RuntimeStore = Object.assign(new MemoryRuntimeStore(), { states: store.states, decisions: store.decisions, alerts: store.alerts });
    const b = await runDataCycle({ provider: providerFor(bullFeeds()), store: restarted }, config(), END + 60_000);
    assert.equal(b.kind, "UNCHANGED");
    assert.equal(b.kind === "UNCHANGED" && b.decision.decision, a.decision.decision);
  });
  it("untrusted durable state => BLOCKED RUNTIME_STATE_UNAVAILABLE (no speculative reconstruction)", async () => {
    const store = new MemoryRuntimeStore();
    evaluated(await runDataCycle({ provider: providerFor(bullFeeds()), store }, config(), END));
    store.decisions.clear();
    const missing = await runDataCycle({ provider: providerFor(bullFeeds()), store }, config(), END);
    assert.deepEqual([missing.kind, missing.kind === "RUNTIME_STATE_UNAVAILABLE" && missing.blocker], ["RUNTIME_STATE_UNAVAILABLE", "RUNTIME_STATE_UNAVAILABLE"]);
    const down = new MemoryRuntimeStore();
    down.failing = true;
    const o = await runDataCycle({ provider: providerFor(bullFeeds()), store: down }, config(), END);
    assert.equal(o.kind === "RUNTIME_STATE_UNAVAILABLE" && o.permission, "BLOCKED");
    const other = new MemoryRuntimeStore();
    evaluated(await runDataCycle({ provider: providerFor(bullFeeds()), store: other }, config(), END));
    assert.equal((await runDataCycle({ provider: providerFor(bullFeeds()), store: other }, config({ targetSymbol: "NVDA" }), END)).kind, "RUNTIME_STATE_UNAVAILABLE");
  });
  it("provider returning older data than processed => OUT_OF_ORDER, BLOCKED", async () => {
    const store = new MemoryRuntimeStore();
    evaluated(await runDataCycle({ provider: providerFor(bullFeeds()), store }, config(), END));
    const o = await runDataCycle({ provider: new StaleProvider(providerFor(bullFeeds()), 10 * 60_000), store }, config({ normalizationPolicy: { maxStalenessMs: 60 * 60_000, maxFeedSkewMs: 0 } }), END);
    assert.equal(o.kind, "PROVIDER_FAILURE");
    assert.deepEqual(o.kind === "PROVIDER_FAILURE" && o.failures.map((f) => f.code), ["OUT_OF_ORDER"]);
  });
});

describe("provider failures fail closed (WAIT or BLOCKED, never a setup)", () => {
  const cases: [string, () => ConstructorParameters<typeof Object>[0], string, "WAIT" | "BLOCKED"][] = [
    ["outage", () => new FailingProvider("down"), "PROVIDER_UNAVAILABLE", "BLOCKED"],
    ["rate limited", () => new FailingProvider("rl", "RATE_LIMITED", 1000), "RATE_LIMITED", "WAIT"],
    ["stale", () => new StaleProvider(providerFor(bullFeeds()), 30 * 60_000), "STALE_DATA", "BLOCKED"],
    ["missing bars", () => new MalformedProvider(providerFor(bullFeeds()), "MISSING_BAR"), "MISSING_BARS", "BLOCKED"],
    ["out of order", () => new MalformedProvider(providerFor(bullFeeds()), "OUT_OF_ORDER"), "OUT_OF_ORDER", "BLOCKED"],
    ["symbol mismatch", () => new MalformedProvider(providerFor(bullFeeds()), "WRONG_SYMBOL", "I:SPX"), "INVALID_SYMBOL_MAPPING", "BLOCKED"],
  ];
  for (const [name, make, codeName, permission] of cases) {
    it(`${name} => ${permission} (${codeName}) + one idempotent PROVIDER_FAILURE alert`, async () => {
      const store = new MemoryRuntimeStore();
      const deps = { provider: make() as never, store };
      const o = await runDataCycle(deps, config(), END);
      assert.equal(o.kind, "PROVIDER_FAILURE");
      if (o.kind !== "PROVIDER_FAILURE") return;
      assert.equal(o.permission, permission);
      assert.ok(o.failures.some((f) => f.code === codeName), JSON.stringify(o.failures));
      assert.equal(store.decisions.size, 0, "no decision fabricated");
      await runDataCycle(deps, config(), END + 1000);
      assert.equal(store.alerts.size, 1, "same failure, same market state => one alert");
      assert.equal([...store.alerts.values()][0]!.event, "PROVIDER_FAILURE");
    });
  }
  it("unmapped required symbol => INVALID_SYMBOL_MAPPING; partial market context => BLOCKED", async () => {
    const o = await runDataCycle({ provider: providerFor(bullFeeds()), store: new MemoryRuntimeStore() }, config({ symbolMap: { provider: "x", entries: { SPX: "I:SPX" } } }), END);
    assert.equal(o.kind === "PROVIDER_FAILURE" && o.failures[0]!.code, "INVALID_SYMBOL_MAPPING");
    const noMnq = providerFor({ ...bullFeeds(), MNQ: [] });
    const p = await runDataCycle({ provider: noMnq, store: new MemoryRuntimeStore() }, config(), END);
    assert.equal(p.kind === "PROVIDER_FAILURE" && p.permission, "BLOCKED");
  });
  it("a previous active setup is kept as-is on failure (not upgraded, not reconstructed)", async () => {
    const store = new MemoryRuntimeStore();
    evaluated(await runDataCycle({ provider: providerFor(bullFeeds()), store }, config(), END));
    const o = await runDataCycle({ provider: new FailingProvider("down"), store }, config(), END + 1000);
    assert.equal(o.kind === "PROVIDER_FAILURE" && o.permission, "BLOCKED");
    assert.equal(store.decisions.size, 1);
  });
});

describe("live provider interface", () => {
  it("events trigger serialized cycles; duplicate event ids are ignored; bars re-read through normalization", async () => {
    const feeds = bullFeeds();
    const cut = END - 2 * M15;
    const strip = (s: typeof feeds.TSLA) => s.map((x) => ({ ...x, candles: x.candles.filter((c) => c.timestamp + M5 <= cut) }));
    const live = new MockLiveProvider("live", { TSLA: barsFromSessions(strip(feeds.TSLA), "TSLA"), "I:SPX": barsFromSessions(strip(feeds.SPX), "I:SPX"), "MNQ1!": barsFromSessions(strip(feeds.MNQ), "MNQ1!") });
    const store = new MemoryRuntimeStore();
    const rt = new LiveDataRuntime({ provider: live, live, store }, config());
    await rt.start();
    assert.equal(live.subscribers, 1);
    const rest = (s: typeof feeds.TSLA) => s.at(-1)!.candles.filter((c) => c.timestamp + M5 > cut);
    live.push("I:SPX", barsFromSessions([{ candles: rest(feeds.SPX) }], "I:SPX"), END);
    live.push("MNQ1!", barsFromSessions([{ candles: rest(feeds.MNQ) }], "MNQ1!"), END);
    const e = live.push("TSLA", barsFromSessions([{ candles: rest(feeds.TSLA) }], "TSLA"), END);
    live.push("TSLA", [], END);
    await rt.drain();
    // Cycles are serialized after the pushes: the first sees the full market state, later events change nothing.
    const first = rt.outcomes[0]!;
    assert.equal(first.kind === "EVALUATED" ? first.decision.decision : first.kind, "CALL_SETUP");
    assert.deepEqual(rt.outcomes.slice(1).map((o) => o.kind), ["UNCHANGED", "UNCHANGED", "UNCHANGED"]);
    assert.equal(store.decisions.size, 1);
    const before = rt.outcomes.length;
    (rt as unknown as { onEvent: (x: typeof e) => void }).onEvent(e);
    await rt.drain();
    assert.equal(rt.outcomes.length, before, "duplicate event ignored");
    live.fail({ code: "PROVIDER_UNAVAILABLE", message: "feed dropped" }, END + 5000);
    await rt.drain();
    assert.equal(rt.outcomes.at(-1)!.kind, "PROVIDER_FAILURE");
    await rt.stop();
    assert.equal(live.subscribers, 0);
  });
});
