/** Four-strategy arbitration. This module NEVER creates trade permission.
 * Existing breakout engine remains the sole producer of certified setup decisions
 * until reversal-specific certification and E2E integration are completed.
 */
import type { KlyngeDecision } from "./types.ts";
export type KlyngeStrategy = "K-HR-P" | "K-HD-C" | "K-BR-C" | "K-BD-P";
export type StrategyDirection = "CALL" | "PUT";
export type StrategyEvidence = "UNVERIFIED" | "CANDIDATE" | "RISK_ELIGIBLE" | "CERTIFIED" | "INVALIDATED";
export interface StrategyProposal {
  strategy: KlyngeStrategy;
  direction: StrategyDirection;
  evidence: StrategyEvidence;
  symbol: string;
  timeframe: string;
  evaluatedAt: number;
  setupId: string;
  /** Only legacy breakout setup engine may supply certified decisions for now. */
  certifiedDecision?: KlyngeDecision;
}
export interface StrategyArbitration {
  decision: KlyngeDecision;
  selected?: StrategyProposal;
  reasons: readonly string[];
  deduplicationKey?: string;
}
const directionOf=(s:KlyngeStrategy):StrategyDirection=>s==="K-HD-C"||s==="K-BR-C"?"CALL":"PUT";
const isReversal=(s:KlyngeStrategy)=>s==="K-HD-C"||s==="K-HR-P";
/** Pure, fail-closed, deterministic; no alerts are sent by this function. */
export function arbitrateStrategies(proposals:readonly StrategyProposal[]):StrategyArbitration {
  if(!proposals.length) return {decision:"WAIT",reasons:["No strategy proposals"]};
  if(proposals.some(p=>!p.symbol || !p.timeframe || !p.setupId || !Number.isFinite(p.evaluatedAt) || p.direction!==directionOf(p.strategy)))
    return {decision:"BLOCKED",reasons:["Invalid strategy identity or direction"]};
  const first=proposals[0]!;
  if(proposals.some(p=>p.symbol!==first.symbol || p.timeframe!==first.timeframe || p.evaluatedAt!==first.evaluatedAt))
    return {decision:"BLOCKED",reasons:["Cross-symbol, timeframe or evaluation-time proposals cannot be arbitrated"]};
  const active=proposals.filter(p=>p.evidence!=="INVALIDATED" && p.evidence!=="UNVERIFIED");
  if(new Set(active.map(p=>p.direction)).size>1)
    return {decision:"BLOCKED",reasons:["Opposing CALL and PUT strategy evidence; no direction authorized"]};
  const certified=active.filter(p=>p.evidence==="CERTIFIED");
  if(certified.some(p=>isReversal(p.strategy)))
    return {decision:"BLOCKED",reasons:["Reversal certification is not enabled"]};
  if(certified.some(p=>p.certifiedDecision!==(p.direction==="CALL"?"CALL_SETUP":"PUT_SETUP")))
    return {decision:"BLOCKED",reasons:["Certification does not match breakout engine decision"]};
  if(new Set(certified.map(p=>p.setupId)).size>1)
    return {decision:"BLOCKED",reasons:["Multiple competing certified setup identities"]};
  if(certified.length){
    const selected=certified[0]!;
    return {decision:selected.certifiedDecision!,selected,reasons:["Existing breakout certification preserved; downstream alert policy required"],
      deduplicationKey:`${selected.symbol}:${selected.timeframe}:${selected.setupId}:${selected.certifiedDecision}`};
  }
  return {decision:"WAIT",reasons:["Candidates are not certified; awaiting all confirmation and risk gates"]};
}
