import { evaluateTrendFailure, KC_STATES } from './kc-trend-failure.mjs';

/**
 * Pure decision adapter: never sends notifications or places orders.
 * Independent confirmation must be supplied by the caller from validated evidence.
 */
export function evaluateKCAlert({previous, market, candidate}) {
  if (!previous || !market || !candidate) throw new Error('MISSING_INPUT');
  if (!['CALL','PUT'].includes(previous.direction)) throw new Error('INVALID_DIRECTION');
  if (!['CALL','PUT'].includes(candidate.direction)) throw new Error('INVALID_CANDIDATE');
  const failure = evaluateTrendFailure({
    state:previous.state,
    direction:previous.direction,
    breakoutLevel:previous.breakoutLevel,
    invalidationLevel:previous.invalidationLevel,
    bars:market.bars,
    confirmBars:market.confirmBars ?? 2
  });
  if (failure.state === KC_STATES.INVALIDATED) {
    return {
      state:KC_STATES.INVALIDATED,
      priorDirection:previous.direction,
      event:failure.event,
      nextWatch:failure.proposedDirection ?? (previous.direction === 'CALL' ? 'PUT' : 'CALL'),
      alert:null,
      reason:'PRIOR_SETUP_INVALIDATED_NEW_DIRECTION_REQUIRES_INDEPENDENT_CONFIRMATION'
    };
  }
  if (candidate.direction !== previous.direction) {
    return {state:KC_STATES.WATCH,alert:null,reason:'OPPOSITE_DIRECTION_REQUIRES_SEPARATE_SETUP'};
  }
  const checks = ['higherTimeframe','zone','liquidity','reaction','structureShift','confirmation','riskValidated'];
  if (!checks.every(k => candidate[k] === true)) {
    return {state:KC_STATES.WATCH,alert:null,reason:'MISSING_REQUIRED_EVIDENCE'};
  }
  if (previous.state !== KC_STATES.ARMED && previous.state !== KC_STATES.TRIGGERED_CALL && previous.state !== KC_STATES.TRIGGERED_PUT) {
    return {state:KC_STATES.WATCH,alert:null,reason:'SETUP_NOT_ARMED'};
  }
  const state = candidate.direction === 'CALL' ? KC_STATES.TRIGGERED_CALL : KC_STATES.TRIGGERED_PUT;
  return {state,alert:{direction:candidate.direction,signalId:candidate.signalId ?? null},reason:'ALL_GATES_PASSED'};
}
