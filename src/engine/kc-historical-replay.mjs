import {validateBars,validateSignal,scoreBacktest} from './kc-backtest-certification.mjs';

/**
 * Chronological bar replay. signals are externally generated at signalIndex close
 * using data <= that index. Caller must certify signal provenance separately.
 * One position at a time. Entry next bar open; conservative same-bar stop first.
 * Units: per-share/point P&L, NOT options premiums.
 */
export function replayKC({bars,signals,slippage=0,commission=0,minTrades=30}) {
  if (!validateBars(bars).valid) throw new Error('INVALID_BARS');
  if (!Array.isArray(signals) || !Number.isFinite(slippage) || slippage<0 ||
      !Number.isFinite(commission) || commission<0) throw new Error('INVALID_CONFIG');
  let previous=-1;
  for (const s of signals) {
    if (!Number.isInteger(s?.signalIndex) || s.signalIndex<0 ||
        s.signalIndex>=bars.length-1 || s.signalIndex<=previous ||
        !validateSignal(s).valid) throw new Error('INVALID_SIGNAL');
    previous=s.signalIndex;
  }
  const trades=[];let nextAvailable=0;
  for (const s of signals) {
    const start=s.signalIndex+1;
    if (start<nextAvailable) continue;
    const isCall=s.direction==='CALL';
    const entry=bars[start].open+(isCall?slippage:-slippage);
    // Reject if next-open gap invalidates the trade or destroys target geometry.
    if (isCall ? entry<=s.stop || entry>=s.target1 : entry>=s.stop || entry<=s.target1) continue;
    let exit=null, exitIndex=null, reason=null;
    for (let i=start;i<bars.length;i++) {
      const b=bars[i];
      const stopped=isCall?b.low<=s.stop:b.high>=s.stop;
      const target=isCall?b.high>=s.target1:b.low<=s.target1;
      if (stopped) {
        // If stop gaps through at the open, use the worse opening fill.
        exit=isCall?Math.min(b.open,s.stop)-slippage:Math.max(b.open,s.stop)+slippage;
        reason='STOP';exitIndex=i;break;
      }
      if (target) {
        exit=s.target1+(isCall?-slippage:slippage);
        reason='TARGET1';exitIndex=i;break;
      }
    }
    if (exit===null) {
      exit=bars.at(-1).close+(isCall?-slippage:slippage);
      exitIndex=bars.length-1;reason='END_OF_DATA';
    }
    if (exit<=0) throw new Error('INVALID_FILL');
    trades.push({direction:s.direction,entry,exit,cost:commission*2,
      signalIndex:s.signalIndex,entryIndex:start,exitIndex,reason});
    nextAvailable=exitIndex+1;
  }
  return {trades,metrics:scoreBacktest(trades,{minTrades}),
    limitations:['Underlying price only','Signal provenance must be verified','No options greeks or premiums',
      'One position at a time','Stop-first on ambiguous bars']};
}
