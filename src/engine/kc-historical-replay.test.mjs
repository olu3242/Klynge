import test from 'node:test';
import assert from 'node:assert/strict';
import {replayKC} from './kc-historical-replay.mjs';
const b=(time,open,high,low,close)=>({time,open,high,low,close,volume:100});
const s={signalIndex:0,direction:'CALL',entry:100,stop:95,target1:105,target2:110};
test('enters at next bar open and reaches target',()=>{
 const r=replayKC({bars:[b(1,100,101,99,100),b(2,101,106,100,105)],signals:[s],minTrades:1});
 assert.equal(r.trades[0].entry,101);assert.equal(r.trades[0].exit,105);
 assert.equal(r.trades[0].reason,'TARGET1');
});
test('ambiguous candle assumes stop first',()=>{
 const r=replayKC({bars:[b(1,100,101,99,100),b(2,101,107,94,102)],signals:[s],minTrades:1});
 assert.equal(r.trades[0].reason,'STOP');assert.equal(r.trades[0].exit,95);
});
test('stop gap fills at worse open',()=>{
 const r=replayKC({bars:[b(1,100,101,99,100),b(2,99,100,98,99),b(3,90,94,89,92)],signals:[s],minTrades:1});
 assert.equal(r.trades[0].exit,90);
});
test('rejects signals from last candle and unsorted timestamps',()=>{
 assert.throws(()=>replayKC({bars:[b(1,100,101,99,100)],signals:[s]}),/INVALID_SIGNAL/);
 assert.throws(()=>replayKC({bars:[b(2,100,101,99,100),b(1,101,106,100,105)],signals:[s]}),/INVALID_BARS/);
});
test('fees reduce performance',()=>{
 const r=replayKC({bars:[b(1,100,101,99,100),b(2,101,106,100,105)],signals:[s],commission:1,minTrades:1});
 assert.equal(r.trades[0].cost,2);assert.equal(r.metrics.netPnl,2);
});
test('insufficient trades cannot certify',()=>{
 const r=replayKC({bars:[b(1,100,101,99,100),b(2,101,106,100,105)],signals:[s]});
 assert.equal(r.metrics.decision,'INSUFFICIENT_DATA');
});
