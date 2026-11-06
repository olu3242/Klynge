import { test } from "node:test";
import assert from "node:assert/strict";
import { assessWeeklyZone, discoverWeeklyZones, type WeeklyBar } from "./weekly-smart-money-zones.ts";
const W=604800000;
const bar=(i:number,o:number,h:number,l:number,c:number):WeeklyBar=>({timestamp:i*W,open:o,high:h,low:l,close:c,volume:100});
test("weekly zones use only completed origin and impulse candles",()=>{
 const bars=[bar(0,100,105,95,102),bar(1,105,120,104,115)];
 const zones=discoverWeeklyZones({bars,evaluatedAt:W*2});
 assert.equal(zones[0]?.side,"DEMAND"); assert.equal(zones[0]?.low,95);
 assert.equal(zones[0]?.high,102); assert.equal(zones[0]?.status,"FRESH");
 assert.deepEqual(discoverWeeklyZones({bars,evaluatedAt:W+1}),[]);
});
test("weekly retest and broken zone fail closed",()=>{
 const bars=[bar(0,100,105,95,102),bar(1,105,120,104,115),bar(2,111,112,99,108)];
 const zone=discoverWeeklyZones({bars,evaluatedAt:W*3})[0]!;
 assert.equal(zone.status,"TESTED");
 assert.equal(assessWeeklyZone(zone,100,W*3).state,"AT_ZONE");
 assert.equal(assessWeeklyZone(zone,130,W*3).state,"AWAIT_TOUCH");
 assert.equal(assessWeeklyZone(zone,100,W).state,"BLOCKED");
 assert.equal(discoverWeeklyZones({bars:[...bars,bar(3,100,101,90,94)],evaluatedAt:W*4})[0]?.status,"BROKEN");
});
test("weekly bearish displacement creates supply",()=>{
 const z=discoverWeeklyZones({bars:[bar(0,100,105,95,98),bar(1,94,96,80,85)],evaluatedAt:W*2});
 assert.equal(z[0]?.side,"SUPPLY"); assert.equal(z[0]?.low,98); assert.equal(z[0]?.high,105);
});
test("malformed weekly OHLCV rejected",()=>{
 assert.throws(()=>discoverWeeklyZones({bars:[bar(0,100,90,95,99)],evaluatedAt:W}));
});
