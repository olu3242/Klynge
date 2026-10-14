/**
 * KC Trigger v2.1: deterministic trend-failure state transitions.
 * Pure domain function. No market feed, order execution, or notifications.
 * Input prices must be finite positive numbers; bars must be chronological.
 */
export const KC_STATES = Object.freeze({
  WATCH: 'WATCH', ARMED: 'ARMED', TRIGGERED_CALL: 'TRIGGERED_CALL',
  TRIGGERED_PUT: 'TRIGGERED_PUT', INVALIDATED: 'INVALIDATED'
});
const validPrice = n => Number.isFinite(n) && n > 0;
const validBar = b => b && [b.open,b.high,b.low,b.close].every(validPrice)
  && b.low <= Math.min(b.open,b.close) && b.high >= Math.max(b.open,b.close);
export function evaluateTrendFailure({state, direction, breakoutLevel, invalidationLevel, bars, confirmBars = 2}) {
  if (!Object.values(KC_STATES).includes(state)) throw new Error('INVALID_STATE');
  if (!['CALL','PUT'].includes(direction)) throw new Error('INVALID_DIRECTION');
  if (![breakoutLevel,invalidationLevel].every(validPrice)) throw new Error('INVALID_LEVEL');
  if ((direction === 'CALL' && invalidationLevel >= breakoutLevel) ||
      (direction === 'PUT' && invalidationLevel <= breakoutLevel)) throw new Error('INVALID_LEVEL_ORDER');
  if (!Array.isArray(bars) || !bars.every(validBar)) throw new Error('INVALID_BARS');
  if (!Number.isInteger(confirmBars) || confirmBars < 1) throw new Error('INVALID_CONFIRM_BARS');
  if (state === KC_STATES.INVALIDATED) return {state, event:'NO_CHANGE', reverseWatch:false};
  const failure = direction === 'CALL'
    ? b => b.close < invalidationLevel
    : b => b.close > invalidationLevel;
  const recent = bars.slice(-confirmBars);
  const confirmed = recent.length === confirmBars && recent.every(failure);
  if (!confirmed) return {state, event:'NO_CHANGE', reverseWatch:false};
  return {
    state: KC_STATES.INVALIDATED,
    event: direction === 'CALL' ? 'BULL_BREAKOUT_FAILED' : 'BEAR_BREAKOUT_FAILED',
    reverseWatch: true,
    proposedDirection: direction === 'CALL' ? 'PUT' : 'CALL',
    // This is a WATCH candidate, NEVER an opposite trade trigger.
    proposedState: KC_STATES.WATCH,
    evidence: {confirmBars, lastClose: recent.at(-1).close, invalidationLevel}
  };
}
