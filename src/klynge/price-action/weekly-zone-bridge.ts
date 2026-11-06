/** Weekly location -> existing reversal strategy candidate bridge.
 * A weekly zone is contextual evidence only, never a certified entry.
 */
import type { WeeklyZone } from "../levels/weekly-smart-money-zones.ts";
import { assessWeeklyZone } from "../levels/weekly-smart-money-zones.ts";
import type { HistoricalReversalStrategy } from "./historical-reversal.ts";
export interface WeeklyZoneProposal {
  strategy: HistoricalReversalStrategy;
  state: "BLOCKED" | "WAIT" | "CANDIDATE";
  reasons: readonly string[];
  zoneConfirmedAt: number;
}
export function proposeWeeklyZoneReversal(input: {
  zone: WeeklyZone;
  currentPrice: number;
  evaluatedAt: number;
  /** Confirmation from separately validated closed 5m reversal lifecycle. */
  lifecycleConfirmed: boolean;
  /** Independently verified VWAP, EMA9, volume and regime gates. */
  evidenceVerified: boolean;
}): WeeklyZoneProposal {
  const strategy: HistoricalReversalStrategy=input.zone.side==="DEMAND"?"K-HD-C":"K-HR-P";
  const loc=assessWeeklyZone(input.zone,input.currentPrice,input.evaluatedAt);
  const base={strategy,zoneConfirmedAt:input.zone.confirmedAt};
  if(loc.state==="BLOCKED") return {...base,state:"BLOCKED",reasons:[loc.reason]};
  if(loc.state!=="AT_ZONE") return {...base,state:"WAIT",reasons:[loc.reason]};
  if(!input.lifecycleConfirmed || !input.evidenceVerified)
    return {...base,state:"WAIT",reasons:["Zone touched; verified lifecycle and indicator gates required"]};
  return {...base,state:"CANDIDATE",reasons:["Weekly zone and reversal evidence observed; risk and strategy certification still pending"]};
}
