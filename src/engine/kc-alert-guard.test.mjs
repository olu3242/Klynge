import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateKCAlert} from './kc-alert-guard.mjs';
const bar = close => ({open:close,high:close+1,low:close-1,close});
const previous={state:'TRIGGERED_CALL',direction:'CALL',breakoutLevel:601.49,invalidationLevel:595.22};
const market={bars:[bar(594),bar(593)]};
const confirmed={direction:'PUT',higherTimeframe:true,zone:true,liquidity:true,reaction:true,structureShift:true,confirmation:true,riskValidated:true};
test('failed call never directly generates put alert',()=>{
 const r=evaluateKCAlert({previous,market,candidate:confirmed});
 assert.equal(r.state,'INVALIDATED'); assert.equal(r.alert,null); assert.equal(r.nextWatch,'PUT');
});
test('opposite direction cannot reuse prior armed setup',()=>{
 const r=evaluateKCAlert({previous:{...previous,state:'ARMED'},market:{bars:[bar(600)]},candidate:confirmed});
 assert.equal(r.alert,null); assert.equal(r.reason,'OPPOSITE_DIRECTION_REQUIRES_SEPARATE_SETUP');
});
test('missing evidence blocks same direction',()=>{
 const r=evaluateKCAlert({previous:{...previous,state:'ARMED'},market:{bars:[bar(600)]},candidate:{...confirmed,direction:'CALL',liquidity:false}});
 assert.equal(r.alert,null);
});
test('armed and fully confirmed same direction emits candidate alert',()=>{
 const r=evaluateKCAlert({previous:{...previous,state:'ARMED'},market:{bars:[bar(600)]},candidate:{...confirmed,direction:'CALL',signalId:'example-1'}});
 assert.equal(r.state,'TRIGGERED_CALL'); assert.equal(r.alert.signalId,'example-1');
});
