import type { BlockerCode } from "../domain/blockers.ts";
import type { Candle } from "../domain/types.ts";
import { isTimeframe } from "../timeframe/timeframe.ts";

export type CandleIssueCode =
  | "EMPTY_SYMBOL"
  | "INVALID_TIMEFRAME"
  | "INVALID_TIMESTAMP"
  | "NON_FINITE_PRICE"
  | "NON_FINITE_VOLUME"
  | "HIGH_BELOW_LOW"
  | "OPEN_ABOVE_HIGH"
  | "OPEN_BELOW_LOW"
  | "CLOSE_ABOVE_HIGH"
  | "CLOSE_BELOW_LOW"
  | "NEGATIVE_VOLUME";

export interface CandleIssue {
  code: CandleIssueCode;
  blocker: BlockerCode;
  message: string;
}

const PRICE_FIELDS = ["open", "high", "low", "close"] as const;

/** Validate a single candle. Returns every issue found (empty array = valid). */
export function validateCandle(candle: Candle): CandleIssue[] {
  const issues: CandleIssue[] = [];
  const add = (code: CandleIssueCode, blocker: BlockerCode, message: string) => issues.push({ code, blocker, message });

  if (typeof candle.symbol !== "string" || candle.symbol.trim() === "") {
    add("EMPTY_SYMBOL", "BAD_DATA", "candle symbol is empty");
  }
  if (!isTimeframe(candle.timeframe)) {
    add("INVALID_TIMEFRAME", "BAD_DATA", `invalid timeframe "${String(candle.timeframe)}"`);
  }
  if (!Number.isSafeInteger(candle.timestamp) || candle.timestamp <= 0) {
    add("INVALID_TIMESTAMP", "BAD_DATA", `invalid timestamp ${String(candle.timestamp)}`);
  }

  const pricesFinite = PRICE_FIELDS.every((f) => typeof candle[f] === "number" && Number.isFinite(candle[f]));
  if (!pricesFinite) {
    add("NON_FINITE_PRICE", "MALFORMED_OHLC", "OHLC contains a non-finite value");
  } else {
    const { open, high, low, close } = candle;
    if (high < low) add("HIGH_BELOW_LOW", "MALFORMED_OHLC", "high < low");
    if (open > high) add("OPEN_ABOVE_HIGH", "MALFORMED_OHLC", "open > high");
    if (open < low) add("OPEN_BELOW_LOW", "MALFORMED_OHLC", "open < low");
    if (close > high) add("CLOSE_ABOVE_HIGH", "MALFORMED_OHLC", "close > high");
    if (close < low) add("CLOSE_BELOW_LOW", "MALFORMED_OHLC", "close < low");
  }

  if (typeof candle.volume !== "number" || !Number.isFinite(candle.volume)) {
    add("NON_FINITE_VOLUME", "BAD_DATA", "volume is non-finite");
  } else if (candle.volume < 0) {
    add("NEGATIVE_VOLUME", "NEGATIVE_VOLUME", "volume is negative");
  }

  return issues;
}
