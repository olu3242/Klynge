/** Weekly supply/demand zone observations. Not trade signals or institutional-order claims.
 * All bars must be completed before evaluatedAt. Never use future bars to discover a zone.
 */
export interface WeeklyBar { timestamp: number; open: number; high: number; low: number; close: number; volume: number; }
export type ZoneSide = "DEMAND" | "SUPPLY";
export interface WeeklyZone { side: ZoneSide; low: number; high: number; originAt: number; confirmedAt: number; touches: number; status: "FRESH" | "TESTED" | "BROKEN"; }
export interface WeeklyZoneInput {
  bars: readonly WeeklyBar[];
  evaluatedAt: number;
  /** Milliseconds per bar; provider must supply verified completed weekly bars. */
  weekMs?: number;
  /** Minimum displacement as a fraction of origin candle's range. */
  impulseRatio?: number;
  /** Maximum subsequent retests to keep the zone eligible. */
  maxTouches?: number;
}
export function discoverWeeklyZones(input: WeeklyZoneInput): readonly WeeklyZone[] {
  const { bars, evaluatedAt } = input;
  const weekMs = input.weekMs ?? 604800000;
  const impulseRatio = input.impulseRatio ?? 1.5;
  const maxTouches = input.maxTouches ?? 3;
  if (!Number.isFinite(evaluatedAt) || !Number.isSafeInteger(weekMs) || weekMs <= 0 ||
      !Number.isFinite(impulseRatio) || impulseRatio <= 0 || !Number.isSafeInteger(maxTouches) || maxTouches < 0)
    throw new RangeError("Invalid weekly zone policy");
  const eligible: WeeklyBar[] = [];
  for (const b of bars) {
    if (![b.timestamp,b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite) ||
        b.timestamp < 0 || b.low <= 0 || b.high < b.low || b.high < Math.max(b.open,b.close) ||
        b.low > Math.min(b.open,b.close) || b.volume < 0 ||
        (eligible.length && b.timestamp <= (eligible[eligible.length-1] as WeeklyBar).timestamp))
      throw new RangeError("Malformed or unordered weekly OHLCV");
    if (b.timestamp + weekMs <= evaluatedAt) eligible.push(b);
    else if (b.timestamp < evaluatedAt && b.timestamp + weekMs > evaluatedAt) {
      // Ignore an unfinished bar; never use it to infer a zone.
      continue;
    } else if (b.timestamp >= evaluatedAt) continue;
  }
  const zones: WeeklyZone[] = [];
  for (let i=0; i+1<eligible.length; i++) {
    const origin=eligible[i] as WeeklyBar, impulse=eligible[i+1] as WeeklyBar;
    const range=origin.high-origin.low;
    if (range <= 0) continue;
    const up=impulse.close>origin.high && impulse.close-origin.high>=range*impulseRatio;
    const down=impulse.close<origin.low && origin.low-impulse.close>=range*impulseRatio;
    if (!up && !down) continue;
    const side: ZoneSide=up?"DEMAND":"SUPPLY";
    const low=up?origin.low:Math.min(origin.open,origin.close);
    const high=up?Math.max(origin.open,origin.close):origin.high;
    let touches=0, broken=false;
    for (let j=i+2;j<eligible.length;j++) {
      const b=eligible[j] as WeeklyBar;
      if (side==="DEMAND" ? b.close<low : b.close>high) { broken=true; break; }
      if (b.low<=high && b.high>=low) touches++;
    }
    zones.push({side,low,high,originAt:origin.timestamp,confirmedAt:impulse.timestamp+weekMs,
      touches,status:broken||touches>maxTouches?"BROKEN":touches?"TESTED":"FRESH"});
  }
  return zones.sort((a,b)=>b.confirmedAt-a.confirmedAt);
}
/** Location-only assessment; no order placement or strategy certification. */
export function assessWeeklyZone(zone: WeeklyZone, price: number, evaluatedAt: number):
  { state: "BLOCKED" | "AWAIT_TOUCH" | "AT_ZONE"; reason: string } {
  if (!Number.isFinite(price) || price<=0 || !Number.isFinite(evaluatedAt) ||
      zone.confirmedAt>evaluatedAt || zone.low<=0 || zone.high<zone.low || zone.status==="BROKEN")
    return {state:"BLOCKED",reason:"Unconfirmed, invalid, or broken zone"};
  return price>=zone.low && price<=zone.high
    ? {state:"AT_ZONE",reason:"Location observed; closed-candle sweep/reclaim, retest, regime, risk and trade authorization required"}
    : {state:"AWAIT_TOUCH",reason:"Price outside historical zone"};
}
