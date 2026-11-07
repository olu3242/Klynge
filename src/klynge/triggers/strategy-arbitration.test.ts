import assert from "node:assert/strict";
import {describe,it} from "node:test";
import {arbitrateStrategies,type StrategyProposal} from "./strategy-arbitration.ts";
const t=Date.UTC(2026,9,26,15);
const proposal=(strategy:StrategyProposal["strategy"],evidence:StrategyProposal["evidence"]):StrategyProposal=>({
 strategy,direction:strategy==="K-HD-C"||strategy==="K-BR-C"?"CALL":"PUT",
 evidence,symbol:"SPY",timeframe:"5m",evaluatedAt:t,setupId:strategy+":100"
});
describe("four strategy arbitration",()=>{
 it("waits on reversal candidates",()=>assert.equal(arbitrateStrategies([proposal("K-HD-C","RISK_ELIGIBLE")]).decision,"WAIT"));
 it("blocks opposing active directions",()=>assert.equal(arbitrateStrategies([proposal("K-HD-C","CANDIDATE"),proposal("K-HR-P","CANDIDATE")]).decision,"BLOCKED"));
 it("does not accept fabricated reversal certification",()=>assert.equal(arbitrateStrategies([{...proposal("K-HD-C","CERTIFIED"),certifiedDecision:"CALL_SETUP"}]).decision,"BLOCKED"));
 it("preserves certified breakout signal",()=>{
  const x=arbitrateStrategies([{...proposal("K-BR-C","CERTIFIED"),certifiedDecision:"CALL_SETUP"}]);
  assert.equal(x.decision,"CALL_SETUP");assert.ok(x.deduplicationKey);
 });
 it("blocks mismatched breakout certification",()=>assert.equal(arbitrateStrategies([{...proposal("K-BD-P","CERTIFIED"),certifiedDecision:"CALL_SETUP"}]).decision,"BLOCKED"));
 it("blocks multiple certified identities",()=>assert.equal(arbitrateStrategies([
  {...proposal("K-BR-C","CERTIFIED"),certifiedDecision:"CALL_SETUP"},
  {...proposal("K-BR-C","CERTIFIED"),setupId:"other",certifiedDecision:"CALL_SETUP"}
 ]).decision,"BLOCKED"));
 it("rejects cross-symbol aggregation",()=>assert.equal(arbitrateStrategies([proposal("K-HD-C","CANDIDATE"),{...proposal("K-HD-C","CANDIDATE"),symbol:"QQQ"}]).decision,"BLOCKED"));
});
