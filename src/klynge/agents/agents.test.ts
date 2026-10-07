import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateMarketTruth } from "../engine/market-truth.ts";
import { makeSession, nowAfter } from "../test-fixtures.ts";
import { agentView, AUTHORITY_HIERARCHY, checkAgentClaim } from "./authority.ts";
import { AGENT_IDS, AGENTS } from "./registry.ts";

const spx = makeSession({ symbol: "SPX", trend: "up" });
const mnq = makeSession({ symbol: "MNQ", trend: "down" });
const snapshot = evaluateMarketTruth({ spx, mnq, now: nowAfter(spx) }); // MIXED => BLOCKED

describe("agent registry", () => {
  it("has the 11 canonical agents with canonical names", () => {
    assert.equal(AGENT_IDS.length, 11);
    for (const id of AGENT_IDS) {
      assert.equal(AGENTS[id].id, id);
      assert.match(AGENTS[id].name, /^Klynge [A-Z][a-z]+ Agent$/);
    }
    assert.equal(AGENTS.explainabilityAgent.name, "Klynge Explainability Agent");
  });
  it("authority order is engine > agent > user", () => assert.deepEqual([...AUTHORITY_HIERARCHY], ["DETERMINISTIC_ENGINE", "AGENT", "USER"]));
});

describe("agent authority", () => {
  it("snapshot under test is MIXED + BLOCKED", () => {
    assert.equal(snapshot.regime.regime, "MIXED");
    assert.equal(snapshot.permission.permission, "BLOCKED");
  });
  it("agents may explain consistent state", () => {
    assert.deepEqual(checkAgentClaim(snapshot, { agentId: "explainabilityAgent", action: "explain", regime: "MIXED", permission: "BLOCKED" }), { ok: true, violations: [] });
  });
  it("cannot bypass BLOCKED", () => assert.equal(checkAgentClaim(snapshot, { agentId: "riskAgent", action: "explain", permission: "ENABLED" }).ok, false));
  it("cannot override MIXED", () => assert.equal(checkAgentClaim(snapshot, { agentId: "contextAgent", action: "summarize", regime: "RISK_ON" }).ok, false));
  it("cannot fabricate direction", () => assert.equal(checkAgentClaim(snapshot, { agentId: "contextAgent", action: "summarize", mnq: "BULLISH" }).ok, false));
  it("cannot take non-permitted actions", () => assert.equal(checkAgentClaim(snapshot, { agentId: "marketAgent", action: "place_order" }).ok, false));
  it("cannot override UNKNOWN", () => {
    const unknown = evaluateMarketTruth({ spx, mnq, now: nowAfter(spx) + 24 * 3600_000 });
    assert.equal(unknown.regime.regime, "UNKNOWN");
    assert.equal(checkAgentClaim(unknown, { agentId: "contextAgent", action: "explain", regime: "RISK_OFF" }).ok, false);
  });
  it("cannot mutate deterministic results", () => {
    const view = agentView(snapshot);
    assert.throws(() => {
      (view.permission as { permission: string }).permission = "ENABLED";
    }, TypeError);
    assert.throws(() => {
      (view.regime.blockers as string[]).length = 0;
    }, TypeError);
    assert.equal(snapshot.permission.permission, "BLOCKED");
  });
});
