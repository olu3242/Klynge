/** Reversal-specific sweep -> reclaim -> retest -> continuation lifecycle.
 * Separate from breakout acceptance; no autonomous trade certification.
 */
import type { Candle } from "../domain/types.ts";
import type { HistoricalReversalStrategy } from "./historical-reversal.ts";
export type ReversalPhase = "WAITING" | "SWEPT" | "RECLAIMED" | "RETESTING" | "CONFIRMED" | "INVALIDATED" | "BLOCKED";
export interface ReversalLifecycleInput {
  strategy: HistoricalReversalStrategy;
  candles: readonly Candle[];
  level: number;
  levelKnownAt: number;
  evaluatedAt: number;
  atr: number;
  toleranceAtr?: number;
  maxBars?: number;
}
export interface ReversalLifecycleResult {
  phase: ReversalPhase;
  strategy: HistoricalReversalStrategy;
  sweepIndex?: number | undefined;
  retestIndex?: number | undefined;
  confirmedIndex?: number | undefined;
  invalidation?: number | undefined;
  reasons: readonly string[];
}
export function evaluateReversalLifecycle(input: ReversalLifecycleInput): ReversalLifecycleResult {
  const {strategy,candles,level,levelKnownAt,evaluatedAt,atr}=input;
  const result=(phase:ReversalPhase,reason:string,extra:Partial<ReversalLifecycleResult>={}):ReversalLifecycleResult=>({strategy,phase,reasons:[reason],...extra});
  const tol=input.toleranceAtr ?? 0.25, maxBars=input.maxBars ?? 12;
  if (!Number.isFinite(level) || level<=0 || !Number.isFinite(levelKnownAt) || !Number.isFinite(evaluatedAt) ||
      !Number.isFinite(atr) || atr<=0 || !Number.isFinite(tol) || tol<0 ||
      !Number.isSafeInteger(maxBars) || maxBars<3 || levelKnownAt>evaluatedAt)
    return result("BLOCKED","Invalid level, ATR or lifecycle policy");
  for(let i=0;i<candles.length;i++){
    const b=(candles[i] as Candle);
    if(b.timeframe!=="5m" || ![b.timestamp,b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite) ||
      b.high<Math.max(b.open,b.close) || b.low>Math.min(b.open,b.close) || b.high<b.low || b.volume<0 ||
      b.timestamp+300000>evaluatedAt || (i>0 && b.timestamp<=(candles[i-1] as Candle).timestamp))
      return result("BLOCKED","Unverified or unfinished five-minute candles");
  }
  const d=strategy==="K-HD-C"?1:-1;
  const favorable=(x:number)=>d*(x-level);
  let phase:ReversalPhase="WAITING", sweepIndex:number|undefined, retestIndex:number|undefined;
  let extreme:number|undefined;
  for(let i=0;i<candles.length;i++){
    const b=(candles[i] as Candle);
    if(b.timestamp<levelKnownAt) continue;
    if(sweepIndex!==undefined && i-sweepIndex>maxBars) return result("INVALIDATED","Reversal timed out",{sweepIndex,retestIndex});
    const adverse=d===1?b.low:b.high;
    if(phase==="WAITING" && favorable(adverse)<0 && favorable(b.close)>0){
      sweepIndex=i; extreme=adverse; phase="SWEPT"; continue;
    }
    if(phase==="SWEPT"){
      if(favorable(b.close)<=0) return result("INVALIDATED","Reclaim failed",{sweepIndex});
      phase="RECLAIMED"; continue;
    }
    if(phase==="RECLAIMED"){
      if(favorable(b.close)<=0) return result("INVALIDATED","Reclaimed level lost",{sweepIndex});
      if(favorable(adverse)<=tol*atr){
        retestIndex=i; extreme=d===1?Math.min((extreme as number),adverse):Math.max((extreme as number),adverse);
        phase="RETESTING";
      }
      continue;
    }
    if(phase==="RETESTING"){
      extreme=d===1?Math.min((extreme as number),adverse):Math.max((extreme as number),adverse);
      if(favorable(b.close)<=0) return result("INVALIDATED","Retest closed through level",{sweepIndex,retestIndex});
      const previous=(candles[i-1] as Candle);
      const priorExtreme=d===1?previous.high:previous.low;
      if(d*(b.close-priorExtreme)>0){
        const invalidation=(extreme as number)-d*tol*atr;
        return result("CONFIRMED","Reversal price-action lifecycle confirmed; trade permission and risk still pending",{sweepIndex,retestIndex,confirmedIndex:i,invalidation});
      }
    }
  }
  return result(phase,"Awaiting further closed-candle evidence",{sweepIndex,retestIndex});
}
