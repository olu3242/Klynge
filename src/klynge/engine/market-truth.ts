import { deepFreeze } from "../domain/freeze.ts";
import type { DataQualityState, RegimeState, TechnicalState, TradePermissionResult, TradingSession } from "../domain/types.ts";
import { assessSnapshotSync, mergeDataQuality } from "../data-quality/series-quality.ts";
import { DEFAULT_DATA_QUALITY_POLICY } from "../policies/data-quality-policy.ts";
import type { DataQualityPolicy } from "../policies/data-quality-policy.ts";
import { evaluateTradePermission } from "../policies/trade-permission.ts";
import { evaluateRegime, unknownRegime } from "../regime/regime-engine.ts";
import { buildTechnicalState } from "./technical-state.ts";
import { provenance } from "./version.ts";
import type { DecisionProvenance } from "./version.ts";

export interface MarketTruthInput {
  spx: TradingSession;
  mnq: TradingSession;
  now: number;
  policy?: DataQualityPolicy;
}

export interface MarketTruthSnapshot {
  technical: { spx: TechnicalState | null; mnq: TechnicalState | null };
  dataQuality: DataQualityState;
  regime: RegimeState;
  permission: TradePermissionResult;
  provenance: DecisionProvenance;
}

/**
 * Single deterministic entrypoint: sessions -> data quality -> technical state -> regime -> permission.
 * Output is deep-frozen. Identical input => identical output.
 */
export function evaluateMarketTruth(input: MarketTruthInput): Readonly<MarketTruthSnapshot> {
  const policy = input.policy ?? DEFAULT_DATA_QUALITY_POLICY;
  const ctx = { now: input.now, policy };
  const spx = buildTechnicalState(input.spx, ctx);
  const mnq = buildTechnicalState(input.mnq, ctx);

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

  return deepFreeze({
    technical: { spx: spx.ok ? spx.state : null, mnq: mnq.ok ? mnq.state : null },
    dataQuality,
    regime,
    permission: evaluateTradePermission(regime, dataQuality),
    provenance: provenance(input.now),
  });
}
