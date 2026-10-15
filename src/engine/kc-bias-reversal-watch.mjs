import {validateBars} from './kc-backtest-certification.mjs';

/**
 * Evaluate a bearish WATCH thesis against chronological, validated OHLCV.
 * Reclaim must be confirmed by consecutive closes above resistance.
 * Never emits a CALL trade; this creates only a new WATCH candidate.
 */
export function evaluateBearishWatchReclaim({ticker,setupId,priorState,priorDirection,bars,reclaimLevel,confirmBars=2}) {
  if (typeof ticker!=='string'||!/^[A-Z.]{1,10}$/.test(ticker)) throw new Error('INVALID_TICKER');
  if (typeof setupId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(setupId)) throw new Error('INVALID_SETUP_ID');
  if (priorState!=='WATCH'||priorDirection!=='PUT') throw new Error('INVALID_PRIOR_WATCH');
  if (!Number.isFinite(reclaimLevel)||reclaimLevel<=0) throw new Error('INVALID_RECLAIM_LEVEL');
  if (!Number.isInteger(confirmBars)||confirmBars<2) throw new Error('INVALID_CONFIRMATION');
  const validated=validateBars(bars);
  if (!validated.valid) throw new Error('INVALID_BARS');
  const recent=bars.slice(-confirmBars);
  if (recent.length<confirmBars || !recent.every(b=>b.close>reclaimLevel)) {
    return {ticker,setupId,state:'PUT_WATCH',event:'NO_CONFIRMED_RECLAIM',alert:null};
  }
  const confirmationTime=recent.at(-1).time;
  return {ticker,setupId,state:'CALL_WATCH',event:'BEARISH_THESIS_INVALIDATED',
    priorState:'PUT_WATCH',priorDirection:'PUT',candidateDirection:'CALL',
    confirmationTime,confirmationCloses:recent.map(b=>b.close),
    alert:null,reason:'CALL_REQUIRES_INDEPENDENT_CONFIRMATION'};
}
