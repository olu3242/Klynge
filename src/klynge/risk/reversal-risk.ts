/** Additive reversal risk orchestration. Does not emit CALL_SETUP or PUT_SETUP:
 * permission and volume certification remain separate integration work.
 */
import type { Direction } from "../domain/types.ts";
import type { PriceLevel } from "../levels/types.ts";
import { evaluateRisk, type RiskState } from "../risk/risk-engine.ts";
import type { ReversalLifecycleResult } from "../price-action/reversal-lifecycle.ts";
export interface ReversalRiskInput {
  lifecycle: ReversalLifecycleResult;
  level: PriceLevel;
  targets: readonly PriceLevel[];
  currentPrice: number;
  atr14: number;
  spx: Direction;
  mnq: Direction;
  /** Verified relative volume of the completed confirmation candle. */
  relativeVolume?: number;
  /** Evaluation instant; must follow the level's confirmation timestamp. */
  evaluatedAt: number;
}
export interface ReversalRiskDecision {
  status: "BLOCKED" | "RISK_ELIGIBLE";
  /** RISK_ELIGIBLE is NOT trade certification or alert permission. */
  reasons: readonly string[];
  risk?: Readonly<RiskState>;
}
export function evaluateReversalRisk(input: ReversalRiskInput): ReversalRiskDecision {
  const blocked = (reason:string):ReversalRiskDecision=>({status:"BLOCKED",reasons:[reason]});
  const side=input.lifecycle.strategy==="K-HD-C"?"BULLISH":"BEARISH";
  if(input.lifecycle.phase!=="CONFIRMED" || input.lifecycle.confirmedIndex===undefined ||
     input.lifecycle.invalidation===undefined)
    return blocked("Price-action reversal lifecycle not confirmed");
  if(!input.level.confirmed || input.level.confirmedAt===undefined ||
     !Number.isFinite(input.evaluatedAt) || input.level.confirmedAt>input.evaluatedAt)
    return blocked("Historical level not verified as of evaluation");
  if(input.spx!==side || input.mnq!==side)
    return blocked("SPX and MNQ must align with reversal direction");
  if(!Number.isFinite(input.relativeVolume) || (input.relativeVolume ?? Number.NaN) < 1.2)
    return blocked("Verified confirmation relative volume >= 1.2 required");
  if(!Number.isFinite(input.currentPrice) || input.currentPrice<=0 ||
     !Number.isFinite(input.atr14) || input.atr14<=0)
    return blocked("Valid price and ATR required");
  const risk=evaluateRisk({
    side, level:{id:input.level.id,price:input.level.price},
    invalidation:input.lifecycle.invalidation,levels:input.targets,
    currentPrice:input.currentPrice,atr14:input.atr14
  });
  return risk.allowed
    ? {status:"RISK_ELIGIBLE",reasons:["Structural risk gate passed; final data-quality, psychology, options and alert certification remain pending"],risk}
    : {status:"BLOCKED",reasons:risk.reasons,risk};
}
