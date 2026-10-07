import { deepFreeze } from "../domain/freeze.ts";
import type { DataQualityState, RegimeState, TechnicalState, TradePermissionResult, TradingSession } from "../domain/types.ts";
import { assessSnapshotSync, dataQualityFailure, mergeDataQuality } from "../data-quality/series-quality.ts";
import { DEFAULT_DATA_QUALITY_POLICY } from "../policies/data-quality-policy.ts";
import type { DataQualityPolicy } from "../policies/data-quality-policy.ts";
import { assertValidMarketContextPolicy, DEFAULT_MARKET_CONTEXT_POLICY, marketContextSources } from "../policies/market-context-policy.ts";
import type { MarketContextPolicy, MarketContextSource } from "../policies/market-context-policy.ts";
import { evaluateTradePermission } from "../policies/trade-permission.ts";
import { evaluateRegime, unknownRegime } from "../regime/regime-engine.ts";
import { buildTechnicalState } from "./technical-state.ts";
import type { TechnicalStateResult } from "./technical-state.ts";
import { provenance } from "./version.ts";
import type { DecisionProvenance } from "./version.ts";

export interface MarketTruthInput {
  /** PRICE_STRUCTURE leg — must be `contextPolicy.broadMarketSymbol`. */
  spx: TradingSession;
  /** RISK_CONFIRMATION leg — must be `contextPolicy.technologyConfirmationSymbol`. */
  mnq: TradingSession;
  /** Optional VOLUME_PROXY for the SPX leg — must be `contextPolicy.volumeProxySymbol`. */
  volumeProxy?: TradingSession;
  now: number;
  policy?: DataQualityPolicy;
  contextPolicy?: MarketContextPolicy;
}

export interface MarketContextProvenance {
  sources: MarketContextSource[];
  /** Which symbol supplied volume context (VWAP weights, relative volume) for the PRICE_STRUCTURE leg. */
  broadMarketVolumeSource: MarketContextSource;
}

export interface MarketTruthSnapshot {
  technical: { spx: TechnicalState | null; mnq: TechnicalState | null };
  dataQuality: DataQualityState;
  regime: RegimeState;
  permission: TradePermissionResult;
  marketContext: MarketContextProvenance;
  provenance: DecisionProvenance;
}

function roleFailure(dataQuality: DataQualityState): TechnicalStateResult {
  return { ok: false, dataQuality };
}

/**
 * Single deterministic entrypoint: sessions -> data quality -> technical state -> regime -> permission.
 * Role enforcement: a session in the wrong role (e.g. SPY passed as SPX) is BAD data, never silently accepted.
 * Output is deep-frozen. Identical input => identical output.
 */
export function evaluateMarketTruth(input: MarketTruthInput): Readonly<MarketTruthSnapshot> {
  const policy = input.policy ?? DEFAULT_DATA_QUALITY_POLICY;
  const context = input.contextPolicy ?? DEFAULT_MARKET_CONTEXT_POLICY;
  assertValidMarketContextPolicy(context);
  const ctx = { now: input.now, policy };

  // Volume proxy is permitted only when the policy names it and the supplied session matches.
  let proxyViolation: DataQualityState | null = null;
  if (input.volumeProxy) {
    if (context.volumeProxySymbol === null) proxyViolation = dataQualityFailure("BAD_DATA", "volume proxy supplied but not permitted by market-context policy");
    else if (input.volumeProxy.symbol !== context.volumeProxySymbol) {
      proxyViolation = dataQualityFailure("MIXED_SERIES", `volume proxy must be ${context.volumeProxySymbol}, got ${input.volumeProxy.symbol}`);
    }
  }
  const useProxy = input.volumeProxy !== undefined && proxyViolation === null;

  const spx =
    input.spx.symbol !== context.broadMarketSymbol
      ? roleFailure(dataQualityFailure("MIXED_SERIES", `PRICE_STRUCTURE leg must be ${context.broadMarketSymbol}, got ${input.spx.symbol}`))
      : proxyViolation
        ? roleFailure(proxyViolation)
        : buildTechnicalState(input.spx, useProxy && input.volumeProxy ? { ...ctx, volumeProxy: input.volumeProxy } : ctx);
  const mnq =
    input.mnq.symbol !== context.technologyConfirmationSymbol
      ? roleFailure(dataQualityFailure("MIXED_SERIES", `RISK_CONFIRMATION leg must be ${context.technologyConfirmationSymbol}, got ${input.mnq.symbol}`))
      : buildTechnicalState(input.mnq, ctx);

  let regime: RegimeState;
  let dataQuality: DataQualityState;
  if (spx.ok && mnq.ok) {
    const sync = assessSnapshotSync([{ label: "SPX", timestamp: spx.state.timestamp }, { label: "MNQ", timestamp: mnq.state.timestamp }], policy);
    dataQuality = mergeDataQuality(spx.dataQuality, mnq.dataQuality, sync);
    regime = evaluateRegime(spx.state, mnq.state, policy);
  } else {
    dataQuality = mergeDataQuality(spx.dataQuality, mnq.dataQuality);
    const failed = [!spx.ok ? "SPX" : null, !mnq.ok ? "MNQ" : null].filter(Boolean).join(" and ");
    regime = unknownRegime(input.now, [`technical state unavailable for ${failed}`]);
  }

  const broadMarketVolumeSource: MarketContextSource =
    useProxy && input.volumeProxy ? { symbol: input.volumeProxy.symbol, role: "VOLUME_PROXY" } : { symbol: context.broadMarketSymbol, role: "PRICE_STRUCTURE" };

  return deepFreeze({
    technical: { spx: spx.ok ? spx.state : null, mnq: mnq.ok ? mnq.state : null },
    dataQuality,
    regime,
    permission: evaluateTradePermission(regime, dataQuality),
    marketContext: { sources: marketContextSources(context), broadMarketVolumeSource },
    provenance: provenance(input.now),
  });
}
