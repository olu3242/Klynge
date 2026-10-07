import type { PriceActionState } from "./types.ts";

/**
 * Legal transitions. TOUCH != BREAK != ACCEPTANCE != RETEST != CONFIRMATION.
 * FAILED/INVALIDATED only leave via WAITING (a new lifecycle) — never directly to CONFIRMED.
 */
export const LEGAL_TRANSITIONS: Readonly<Record<PriceActionState, readonly PriceActionState[]>> = Object.freeze({
  WAITING: ["TESTING", "BROKEN"],
  TESTING: ["WAITING", "BROKEN"],
  BROKEN: ["ACCEPTED", "FAILED"],
  ACCEPTED: ["RETESTING", "FAILED"],
  RETESTING: ["CONFIRMED", "FAILED"],
  CONFIRMED: ["INVALIDATED"],
  FAILED: ["WAITING"],
  INVALIDATED: ["WAITING"],
});

export class IllegalTransitionError extends Error {
  override readonly name = "IllegalTransitionError";
}

export function isLegalTransition(from: PriceActionState, to: PriceActionState): boolean {
  return from === to || LEGAL_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: PriceActionState, to: PriceActionState): void {
  if (!isLegalTransition(from, to)) throw new IllegalTransitionError(`illegal price-action transition ${from} -> ${to}`);
}

export const TERMINAL_STATES: readonly PriceActionState[] = Object.freeze(["FAILED", "INVALIDATED"]);
export const LIFECYCLE_STATES: readonly PriceActionState[] = Object.freeze(["BROKEN", "ACCEPTED", "RETESTING", "CONFIRMED", "FAILED", "INVALIDATED"]);
