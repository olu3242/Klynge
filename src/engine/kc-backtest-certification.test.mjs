import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBars,validateSignal,scoreBacktest} from './kc-backtest-certification.mjs';
const b=(time,close=100)=>({time,open:close,high:close+1,low:close-1,close,volume:1000});
test('valid chronological OHLCV accepted',()=>assert.equal(validateBars([b(1),b(2)]).valid,true));
test('out of order timestamps rejected',()=>assert.equal(validateBars([b(2),b(1)]).valid,false));
test('malformed OHLCV rejected',()=>assert.equal(validateBars([{...b(1),low:105}]).valid,false));
test('call risk target geometry validated',()=>{
 assert.equal(validateSignal({direction:'CALL',entry:100,stop:95,target1:105,target2:110}).valid,true);
 assert.equal(validateSignal({direction:'CALL',entry:100,stop:105,target1:110,target2:115}).valid,false);
});
test('put geometry validated',()=>assert.equal(validateSignal({direction:'PUT',entry:100,stop:105,target1:95,target2:90}).valid,true));
test('insufficient history cannot pass',()=>{
 assert.equal(scoreBacktest([{direction:'CALL',entry:100,exit:110,cost:1}]).decision,'INSUFFICIENT_DATA');
});
test('loss after costs fails',()=>{
 const trades=Array.from({length:30},()=>({direction:'CALL',entry:100,exit:101,cost:2}));
 assert.equal(scoreBacktest(trades).decision,'FAIL');
});
test('winning sample scores candidate only',()=>{
 const trades=Array.from({length:30},()=>({direction:'CALL',entry:100,exit:103,cost:1}));
 const r=scoreBacktest(trades); assert.equal(r.decision,'CANDIDATE_PASS');assert.equal(r.winRate,1);
});
test('invalid trade fails closed',()=>assert.throws(()=>scoreBacktest([{direction:'PUT',entry:100,exit:90,cost:-1}]),/INVALID_TRADE/));
