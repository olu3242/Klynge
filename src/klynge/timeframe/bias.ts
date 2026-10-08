import type { Direction } from "../domain/types.ts";

export type HigherTimeframeBias = "BULLISH" | "BEARISH" | "NEUTRAL" | "CONFLICTED";

/**
 * Explicit bias table (macro × structure), using the canonical strict direction of each role:
 *   BULLISH + BULLISH => BULLISH
 *   BEARISH + BEARISH => BEARISH
 *   BULLISH + BEARISH (either order) => CONFLICTED
 *   anything involving NEUTRAL => NEUTRAL
 */
export function deriveHigherTimeframeBias(macro: Direction, structure: Direction): HigherTimeframeBias {
  if (macro === "BULLISH" && structure === "BULLISH") return "BULLISH";
  if (macro === "BEARISH" && structure === "BEARISH") return "BEARISH";
  if ((macro === "BULLISH" && structure === "BEARISH") || (macro === "BEARISH" && structure === "BULLISH")) return "CONFLICTED";
  return "NEUTRAL";
}
