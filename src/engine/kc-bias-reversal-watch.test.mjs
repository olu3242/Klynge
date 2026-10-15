import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateBearishWatchReclaim} from './kc-bias-reversal-watch.mjs';
const bar=(time,close)=>({time,open:close,high:close+1,low:close-1,close,volume:100});
const base={ticker:'MU',setupId:'mu-bear-20261015',priorState:'WATCH',priorDirection:'PUT',reclaimLevel:900};
test('two closes above reclaim level move PUT watch to CALL watch only',()=>{
 const r=evaluateBearishWatchReclaim({...base,bars:[bar(1,863),bar(2,905),bar(3,911)]});
 assert.equal(r.state,'CALL_WATCH');assert.equal(r.alert,null);
 assert.equal(r.event,'BEARISH_THESIS_INVALIDATED');
});
test('one reclaim close is insufficient',()=>{
 const r=evaluateBearishWatchReclaim({...base,bars:[bar(1,899),bar(2,911)]});
 assert.equal(r.state,'PUT_WATCH');assert.equal(r.alert,null);
});
test('price at reclaim level does not confirm',()=>{
 const r=evaluateBearishWatchReclaim({...base,bars:[bar(1,901),bar(2,900)]});
 assert.equal(r.state,'PUT_WATCH');
});
test('rejects unsorted OHLCV',()=>{
 assert.throws(()=>evaluateBearishWatchReclaim({...base,bars:[bar(2,901),bar(1,911)]}),/INVALID_BARS/);
});
test('rejects invalid state and invalid level',()=>{
 assert.throws(()=>evaluateBearishWatchReclaim({...base,priorState:'TRIGGERED_PUT',bars:[bar(1,911),bar(2,912)]}),/INVALID_PRIOR_WATCH/);
 assert.throws(()=>evaluateBearishWatchReclaim({...base,reclaimLevel:NaN,bars:[bar(1,911),bar(2,912)]}),/INVALID_RECLAIM_LEVEL/);
});
