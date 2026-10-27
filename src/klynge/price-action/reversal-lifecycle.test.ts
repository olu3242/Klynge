import assert from "node:assert/strict";
import {describe,it} from "node:test";
import type {Candle} from "../domain/types.ts";
import {evaluateReversalLifecycle} from "./reversal-lifecycle.ts";
const t=Date.UTC(2026,9,26,14);
const c=(i:number,o:number,h:number,l:number,close:number):Candle=>({symbol:"SPY",timeframe:"5m",timestamp:t+i*300000,open:o,high:h,low:l,close,volume:1000});
const run=(strategy:"K-HD-C"|"K-HR-P",candles:Candle[])=>evaluateReversalLifecycle({strategy,candles,level:100,levelKnownAt:t-1000,evaluatedAt:t+6*300000,atr:2});
describe("reversal lifecycle",()=>{
 it("confirms bullish sweep, hold, retest and continuation",()=>{
  const x=run("K-HD-C",[c(0,100,101,99,100.4),c(1,100.4,101,100.1,100.8),c(2,100.8,101,100.2,100.5),c(3,100.5,102,100.4,101.5)]);
  assert.equal(x.phase,"CONFIRMED");assert.equal(x.confirmedIndex,3);assert.ok(x.invalidation!<100);
 });
 it("confirms bearish sweep, hold, retest and continuation",()=>{
  const x=run("K-HR-P",[c(0,100,101,99,99.6),c(1,99.6,99.9,99,99.2),c(2,99.2,99.8,99,99.5),c(3,99.5,99.6,98,98.5)]);
  assert.equal(x.phase,"CONFIRMED");assert.ok(x.invalidation!>100);
 });
 it("invalidates failed bullish reclaim",()=>{
  const x=run("K-HD-C",[c(0,100,101,99,100.4),c(1,100.4,101,99.5,99.8)]);
  assert.equal(x.phase,"INVALIDATED");
 });
 it("blocks unfinished bars",()=>{
  const x=evaluateReversalLifecycle({strategy:"K-HD-C",candles:[c(0,100,101,99,100.4)],level:100,levelKnownAt:t-1000,evaluatedAt:t+1,atr:2});
  assert.equal(x.phase,"BLOCKED");
 });
 it("does not promote sweep alone to confirmed",()=>{
  assert.equal(run("K-HD-C",[c(0,100,101,99,100.4)]).phase,"SWEPT");
 });
});
