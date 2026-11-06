import { describe, it, expect } from "vitest";
import { assessWeeklyZone, discoverWeeklyZones, type WeeklyBar } from "./weekly-smart-money-zones.ts";
const W=604800000;
const bar=(i:number,o:number,h:number,l:number,c:number):WeeklyBar=>({timestamp:i*W,open:o,high:h,low:l,close:c,volume:100});
describe("weekly smart money zones",()=>{
  it("detects only completed origin and impulse candles",()=>{
    const bars=[bar(0,100,105,95,102),bar(1,105,120,104,115)];
    expect(discoverWeeklyZones({bars,evaluatedAt:W*2})).toMatchObject([{side:"DEMAND",low:95,high:102,status:"FRESH"}]);
    expect(discoverWeeklyZones({bars,evaluatedAt:W+1})).toEqual([]);
  });
  it("tracks a retest and rejects a broken demand zone",()=>{
    const bars=[bar(0,100,105,95,102),bar(1,105,120,104,115),bar(2,111,112,99,108)];
    const z=discoverWeeklyZones({bars,evaluatedAt:W*3})[0]!;
    expect(z.status).toBe("TESTED");
    expect(assessWeeklyZone(z,100,W*3).state).toBe("AT_ZONE");
    expect(assessWeeklyZone(z,130,W*3).state).toBe("AWAIT_TOUCH");
    expect(discoverWeeklyZones({bars:[...bars,bar(3,100,101,90,94)],evaluatedAt:W*4})[0]!.status).toBe("BROKEN");
  });
  it("detects supply after bearish displacement",()=>{
    const z=discoverWeeklyZones({bars:[bar(0,100,105,95,98),bar(1,94,96,80,85)],evaluatedAt:W*2});
    expect(z).toMatchObject([{side:"SUPPLY",low:98,high:105}]);
  });
  it("fails closed for malformed input and unconfirmed zones",()=>{
    expect(()=>discoverWeeklyZones({bars:[bar(0,100,90,95,99)],evaluatedAt:W})).toThrow();
    const z=discoverWeeklyZones({bars:[bar(0,100,105,95,102),bar(1,105,120,104,115)],evaluatedAt:W*2})[0]!;
    expect(assessWeeklyZone(z,100,W).state).toBe("BLOCKED");
  });
});
