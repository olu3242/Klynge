import assert from "node:assert/strict";
import {describe,it} from "node:test";
import type {PriceLevel} from "../levels/types.ts";
import {evaluateReversalRisk} from "./reversal-risk.ts";
const t=Date.UTC(2026,9,26,15);
const level:PriceLevel={id:"support",symbol:"SPY",timeframe:"5m",price:100,type:"SUPPORT",strength:"STRONG",touches:3,confirmed:true,createdAt:t-900000,confirmedAt:t-600000,source:"historical"};
const target:PriceLevel={...level,id:"target",price:108,type:"RESISTANCE"};
const base=()=>({lifecycle:{strategy:"K-HD-C" as const,phase:"CONFIRMED" as const,confirmedIndex:3,invalidation:98.5,reasons:[]},level,targets:[target],currentPrice:100.2,atr14:2,spx:"BULLISH" as const,mnq:"BULLISH" as const,relativeVolume:1.4,evaluatedAt:t});
describe("reversal risk gate",()=>{
 it("passes only structural risk eligibility, not trade certification",()=>{
  const result=evaluateReversalRisk(base());
  assert.equal(result.status,"RISK_ELIGIBLE");
  assert.ok(result.risk?.rewardRiskRatio!>=2);
 });
 it("blocks missing relative volume",()=>assert.equal(evaluateReversalRisk({...base(),relativeVolume:undefined}).status,"BLOCKED"));
 it("blocks mixed regime",()=>assert.equal(evaluateReversalRisk({...base(),mnq:"BEARISH"}).status,"BLOCKED"));
 it("blocks unconfirmed lifecycle",()=>assert.equal(evaluateReversalRisk({...base(),lifecycle:{...base().lifecycle,phase:"RETESTING" as const}}).status,"BLOCKED"));
 it("blocks inadequate target reward",()=>assert.equal(evaluateReversalRisk({...base(),targets:[{...target,price:102}]}).status,"BLOCKED"));
 it("blocks future-confirmed levels",()=>assert.equal(evaluateReversalRisk({...base(),level:{...level,confirmedAt:t+1}}).status,"BLOCKED"));
});
