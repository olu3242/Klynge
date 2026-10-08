import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bullFeeds, config, END, providerFor } from "../providers/provider-test-fixtures.ts";
import { MemoryRuntimeStore, runDataCycle } from "../runtime/live-runtime.ts";
import { applyConfirmation } from "../visual/confirmation.ts";
import { evaluateVisualContext } from "../visual/visual-context.ts";
import { full, raw, session, T } from "../visual/visual-test-fixtures.ts";
import { HANDOFF_FIELDS, handoffFromVisual } from "./handoff.ts";

describe("VISUAL → DATA handoff (hints only)", () => {
  it("carries symbol/timeframe/intent hints and nothing a chart cannot verify", () => {
    const visual = full("BULLISH", "BULLISH", "BULLISH");
    const h = handoffFromVisual(visual, T, "  watching the opening drive ");
    assert.deepEqual(Object.keys(h).sort(), [...HANDOFF_FIELDS].sort());
    assert.deepEqual([h.symbolHint, h.timeframeHint, h.intent, h.fromEvidenceMode], ["TSLA", "5m", "watching the opening drive", "VISUAL"]);
    const json = JSON.stringify(h);
    for (const forbidden of ["lastPrice", "vwap", "VWAP", "ema", "atr", "ATR", "volume", "levels", "rewardRisk", "decision", "CALL_SETUP", "BULLISH CONTEXT"]) assert.ok(!json.includes(forbidden), forbidden);
    assert.ok(Object.isFrozen(h));
  });
  it("unverified symbol never becomes a hint", () => {
    const s = session([{ r: raw("TSLA", "BULLISH", { symbol: { value: "TSLA", status: "OBSERVED", confidence: 0.2, evidence: "blurry" } }) }]);
    assert.equal(handoffFromVisual(s, T).symbolHint, null);
  });
  it("DATA evaluates independently: identical decision with or without the visual handoff", async () => {
    const bull = full("BULLISH", "BULLISH", "BULLISH");
    const bear = full("BEARISH", "BEARISH", "BEARISH");
    assert.equal(evaluateVisualContext(bear, T).label, "BEARISH CONTEXT");
    const run = async (h?: ReturnType<typeof handoffFromVisual>) => {
      const o = await runDataCycle({ provider: providerFor(bullFeeds()), store: new MemoryRuntimeStore() }, config(), END, h ? { handoff: h } : {});
      assert.equal(o.kind, "EVALUATED");
      return o.kind === "EVALUATED" ? o.decision : null;
    };
    const none = await run();
    assert.deepEqual(await run(handoffFromVisual(bull, T)), none);
    assert.deepEqual(await run(handoffFromVisual(bear, T)), none, "a bearish screenshot cannot pull the DATA decision");
    assert.equal(none?.decision, "CALL_SETUP");
  });
  it("user-confirmed symbol is a valid hint but stays USER_CONFIRMED provenance in the visual session", () => {
    const s = session([{ r: raw("TSLA", "BULLISH", { symbol: { value: "TSLA", status: "OBSERVED", confidence: 0.2, evidence: "blurry" } }) }]);
    const confirmed = applyConfirmation(s.charts[0]!, { field: "symbol", action: "EDIT", value: "TSLA" }, "user", T);
    assert.equal(confirmed.observation.symbol.status, "USER_CONFIRMED");
    assert.equal(handoffFromVisual({ ...s, charts: [confirmed] }, T).symbolHint, "TSLA");
  });
});
