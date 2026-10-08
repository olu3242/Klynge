/**
 * Canonical Klynge market-truth domain.
 * Every engine, UI and agent consumes these types; none may redefine them.
 */
import type { BlockerCode } from "./blockers.ts";

export type Direction = "BULLISH" | "BEARISH" | "NEUTRAL";

export type MarketRegime = "RISK_ON" | "RISK_OFF" | "MIXED" | "UNKNOWN";

export type MarketStructure = "HH_HL" | "LH_LL" | "MIXED";

export type Timeframe = "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d";

export type TradePermission = "ENABLED" | "BLOCKED";

/** VISUAL = observed from chart images; DATA = OHLCV evaluated by the deterministic engine. Never interchangeable. */
export type EvidenceMode = "VISUAL" | "DATA";

export type VolumeClass = "STRONG" | "CONFIRMING" | "NORMAL" | "WEAK";

/** One OHLCV bar. `timestamp` is the bar OPEN time in epoch milliseconds (UTC). */
export interface Candle {
  symbol: string;
  timeframe: Timeframe;
  timestamp: number;

  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** A single trading session. Session VWAP resets per session. `closeTimestamp` is exclusive. */
export interface TradingSession {
  sessionId: string;
  symbol: string;
  timeframe: Timeframe;

  openTimestamp: number;
  closeTimestamp: number;

  candles: Candle[];
}

/** Ascending sessions for one symbol (prior sessions + current). The canonical multi-session input. */
export type TradingHistory = readonly TradingSession[];

export interface TechnicalState {
  symbol: string;
  timeframe: Timeframe;
  /** Open time of the last (closed) candle the state was computed from. */
  timestamp: number;

  price: number;

  vwap: number;
  ema9: number;
  ema9Slope: number;
  atr14: number;

  volume: number;
  averageVolume20: number;
  volumeRatio: number;

  structure: MarketStructure;

  /** Present only when an explicitly permitted volume proxy supplied VWAP weights / relative volume. */
  volumeSymbol?: string;
}

export interface RegimeState {
  timestamp: number;

  spx: Direction;
  mnq: Direction;

  aligned: boolean;
  regime: MarketRegime;

  reasons: string[];
  blockers: BlockerCode[];
}

export interface DataQualityState {
  valid: boolean;

  stale: boolean;
  missingCandles: boolean;
  timestampSkew: boolean;
  sufficientHistory: boolean;

  duplicateTimestamps: boolean;
  outOfOrder: boolean;
  malformedOHLC: boolean;
  negativeVolume: boolean;

  reasons: string[];
  blockers: BlockerCode[];
}

export interface SwingPoint {
  index: number;
  timestamp: number;
  price: number;
  type: "HIGH" | "LOW";
  /**
   * No-lookahead metadata: the swing is only knowable once its right-hand
   * confirmation window has closed. Replay must not use a swing before this.
   */
  confirmedAtIndex: number;
  confirmedAtTimestamp: number;
}

export interface TradePermissionResult {
  permission: TradePermission;
  reasons: string[];
  blockers: BlockerCode[];
}
