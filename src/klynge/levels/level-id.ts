import type { Timeframe } from "../domain/types.ts";
import type { LevelType } from "./types.ts";

/** Canonical price text: up to 4 decimals, no trailing zeros. */
export function canonicalPrice(price: number): string {
  return String(Number(price.toFixed(4)));
}

/** Deterministic level id: SYMBOL:TF:TYPE:PRICE:CREATED_AT (no UUIDs, no randomness). */
export function levelId(symbol: string, timeframe: Timeframe, type: LevelType, price: number, createdAt: number): string {
  return `${symbol}:${timeframe}:${type}:${canonicalPrice(price)}:${createdAt}`;
}
