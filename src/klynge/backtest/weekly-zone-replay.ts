/** Walk-forward observation report: each step only sees completed weekly bars.
 * Descriptive zone counts are NOT a strategy win rate or option P&L.
 */
import { discoverWeeklyZones, type WeeklyBar, type WeeklyZone } from "../levels/weekly-smart-money-zones.ts";
export interface WeeklyZoneReplayRow {
  evaluatedAt: number;
  zonesKnown: number;
  fresh: number;
  tested: number;
  broken: number;
}
export function replayWeeklyZones(input:{
  bars:readonly WeeklyBar[];
  weekMs?:number;
  impulseRatio?:number;
  maxTouches?:number;
}):readonly WeeklyZoneReplayRow[] {
  const weekMs=input.weekMs??604800000;
  const rows:WeeklyZoneReplayRow[]=[];
  for(let i=0;i<input.bars.length;i++){
    const evaluatedAt=(input.bars[i] as WeeklyBar).timestamp+weekMs;
    const args={bars:input.bars,evaluatedAt,weekMs};
    const opts={
      ...args,
      ...(input.impulseRatio===undefined?{}:{impulseRatio:input.impulseRatio}),
      ...(input.maxTouches===undefined?{}:{maxTouches:input.maxTouches})
    };
    const zones:readonly WeeklyZone[]=discoverWeeklyZones(opts);
    rows.push({evaluatedAt,zonesKnown:zones.length,
      fresh:zones.filter(z=>z.status==="FRESH").length,
      tested:zones.filter(z=>z.status==="TESTED").length,
      broken:zones.filter(z=>z.status==="BROKEN").length});
  }
  return rows;
}
