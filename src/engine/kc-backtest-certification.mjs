/** KC backtest certification utilities. No data retrieval or order execution. */
export function validateBars(bars) {
  const errors=[];
  if (!Array.isArray(bars) || bars.length===0) return {valid:false,errors:['EMPTY_OR_INVALID_BARS']};
  let last=-Infinity;
  bars.forEach((b,i)=>{
    if (!b || !Number.isFinite(b.time) || b.time<=last) errors.push(`TIME_ORDER:${i}`);
    else last=b.time;
    if (!b || ![b.open,b.high,b.low,b.close].every(n=>Number.isFinite(n)&&n>0) ||
        b.low>Math.min(b.open,b.close) || b.high<Math.max(b.open,b.close) ||
        !Number.isFinite(b.volume) || b.volume<0) errors.push(`INVALID_OHLCV:${i}`);
  });
  return {valid:errors.length===0,errors};
}
export function validateSignal(s) {
  const errors=[];
  if (!s || !['CALL','PUT'].includes(s.direction)) errors.push('INVALID_DIRECTION');
  if (!s || ![s.entry,s.stop,s.target1,s.target2].every(n=>Number.isFinite(n)&&n>0)) errors.push('INVALID_PRICE');
  if (!errors.length && (s.direction==='CALL'
    ? !(s.stop<s.entry && s.entry<s.target1 && s.target1<=s.target2)
    : !(s.stop>s.entry && s.entry>s.target1 && s.target1>=s.target2))) errors.push('INVALID_LEVEL_ORDER');
  return {valid:errors.length===0,errors};
}
/** Trades must be from independent chronological replay, not hindsight labels.
 * Each trade: {entry, exit, direction, cost} with actual fills.
 */
export function scoreBacktest(trades,{minTrades=30,minProfitFactor=1.3}={}) {
  if (!Array.isArray(trades) || !Number.isInteger(minTrades) || minTrades<1 ||
      !Number.isFinite(minProfitFactor) || minProfitFactor<=0) throw new Error('INVALID_CONFIG');
  let wins=0, grossProfit=0, grossLoss=0, sum=0, equity=0, peak=0, maxDrawdown=0;
  for (const t of trades) {
    if (!t || !['CALL','PUT'].includes(t.direction) ||
      ![t.entry,t.exit].every(n=>Number.isFinite(n)&&n>0) ||
      !Number.isFinite(t.cost) || t.cost<0) throw new Error('INVALID_TRADE');
    const pnl=(t.direction==='CALL'?t.exit-t.entry:t.entry-t.exit)-t.cost;
    if (pnl>0) {wins++;grossProfit+=pnl;} else grossLoss+=-pnl;
    sum+=pnl; equity+=pnl; peak=Math.max(peak,equity); maxDrawdown=Math.max(maxDrawdown,peak-equity);
  }
  const n=trades.length;
  const profitFactor=grossLoss===0?(grossProfit>0?Infinity:0):grossProfit/grossLoss;
  const expectancy=n?sum/n:null;
  const decision=n<minTrades?'INSUFFICIENT_DATA':expectancy>0 && profitFactor>=minProfitFactor?'CANDIDATE_PASS':'FAIL';
  return {trades:n,wins,winRate:n?wins/n:null,expectancy,profitFactor,maxDrawdown,netPnl:sum,decision};
}
