import type { OptionsPolicy } from "./types.ts";

/** Mandatory, prominently displayed with every options result. */
export const OPTIONS_RISK_NOTICE =
  "Klynge is not financial advice. Options involve substantial risk and may expire worthless. A long option position may lose 100% of the premium paid.";

export const MAXIMUM_CAPITAL_AT_RISK_NOTICE = "Maximum capital at risk may equal 100% of premium paid.";

/**
 * PROVISIONAL, conservative defaults — not production-calibrated. Configure per account / instrument.
 */
export const DEFAULT_OPTIONS_POLICY: Readonly<Required<Omit<OptionsPolicy, "maximumPremiumAtRisk">> & Pick<OptionsPolicy, "maximumPremiumAtRisk">> = Object.freeze({
  minimumDte: 7,
  maximumDte: 45,
  minimumOpenInterest: 500,
  minimumVolume: 100,
  maximumSpreadPercent: 10,
  minimumDelta: 0.3,
  maximumDelta: 0.7,
  maximumQuoteAgeMs: 60_000,
  contractMultiplier: 100,
});

export function assertValidOptionsPolicy(p: OptionsPolicy): void {
  for (const [k, v] of Object.entries(p)) {
    if (v !== undefined && (!Number.isFinite(v) || v < 0)) throw new RangeError(`OptionsPolicy.${k} must be a finite, non-negative number`);
  }
  if (p.maximumDte < p.minimumDte) throw new RangeError("OptionsPolicy.maximumDte must be >= minimumDte");
  if (p.minimumDelta !== undefined && p.maximumDelta !== undefined && p.maximumDelta < p.minimumDelta) throw new RangeError("OptionsPolicy delta range is inverted");
  if (p.minimumDelta !== undefined && p.minimumDelta > 1) throw new RangeError("OptionsPolicy.minimumDelta must be <= 1");
}
