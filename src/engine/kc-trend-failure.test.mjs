import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTrendFailure, KC_STATES } from './kc-trend-failure.mjs';
const bar = close => ({open:close,high:close+1,low:close-1,close});
const setup = {state:KC_STATES.TRIGGERED_CALL,direction:'CALL',breakoutLevel:601.49,invalidationLevel:595.22};
test('confirmed bullish failure invalidates, never triggers put',()=>{
 const r=evaluateTrendFailure({...setup,bars:[bar(594),bar(593)]});
 assert.equal(r.state,KC_STATES.INVALIDATED);
 assert.equal(r.proposedState,KC_STATES.WATCH);
 assert.equal(r.proposedDirection,'PUT');
});
test('one bar is insufficient for confirmation',()=>{
 assert.equal(evaluateTrendFailure({...setup,bars:[bar(594)]}).state,KC_STATES.TRIGGERED_CALL);
});
test('reclaim cancels consecutive failure',()=>{
 assert.equal(evaluateTrendFailure({...setup,bars:[bar(594),bar(597)]}).state,KC_STATES.TRIGGERED_CALL);
});
test('bearish failure creates call watch only',()=>{
 const r=evaluateTrendFailure({state:KC_STATES.TRIGGERED_PUT,direction:'PUT',breakoutLevel:130,invalidationLevel:135,bars:[bar(136),bar(137)]});
 assert.equal(r.proposedDirection,'CALL');
 assert.equal(r.proposedState,KC_STATES.WATCH);
});
test('invalid price and malformed candles fail closed',()=>{
 assert.throws(()=>evaluateTrendFailure({...setup,bars:[bar(NaN)]}),/INVALID_BARS/);
 assert.throws(()=>evaluateTrendFailure({...setup,invalidationLevel:610,bars:[]}),/INVALID_LEVEL_ORDER/);
});
test('already invalidated remains invalidated',()=>{
 assert.equal(evaluateTrendFailure({...setup,state:KC_STATES.INVALIDATED,bars:[bar(610)]}).state,KC_STATES.INVALIDATED);
});
