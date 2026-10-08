import { deepFreeze } from "../domain/freeze.ts";
import type { Timeframe } from "../domain/types.ts";
import { chartFor } from "../visual/session.ts";
import type { ChartSession } from "../visual/session.ts";
import { isUsable } from "../visual/types.ts";

/**
 * VISUAL → DATA handoff. Carries HINTS only: which instrument the user was looking at, at what timeframe, and
 * why. It deliberately has no field for prices, VWAP/EMA values, ATR, volume baselines, levels, R:R or any visual
 * decision — the DATA engine starts from verified, normalized market data and evaluates independently.
 */
export interface DataHandoff {
  fromSessionId: string;
  fromEvidenceMode: "VISUAL";
  symbolHint: string | null;
  timeframeHint: Timeframe | null;
  intent: string | null;
  createdAt: number;
}

export const HANDOFF_FIELDS = Object.freeze(["fromSessionId", "fromEvidenceMode", "symbolHint", "timeframeHint", "intent", "createdAt"] as const);

export function handoffFromVisual(session: ChartSession, at: number, intent?: string): Readonly<DataHandoff> {
  const target = chartFor(session, "TARGET");
  const sym = target?.observation.symbol;
  const tf = target?.observation.timeframe;
  return deepFreeze({
    fromSessionId: session.sessionId,
    fromEvidenceMode: "VISUAL" as const,
    symbolHint: sym && isUsable(sym.status) && typeof sym.value === "string" ? sym.value : null,
    timeframeHint: tf && isUsable(tf.status) && tf.value ? (tf.value as Timeframe) : null,
    intent: intent ? intent.trim().slice(0, 280) || null : null,
    createdAt: at,
  });
}
