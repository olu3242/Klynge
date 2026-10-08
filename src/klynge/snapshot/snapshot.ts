import { deepFreeze } from "../domain/freeze.ts";
import type { Candle, EvidenceMode } from "../domain/types.ts";
import { evaluateMultiTimeframeSetup } from "../pipeline/mtf-pipeline.ts";
import type { MultiTimeframePipelineInput, MultiTimeframePipelineResult } from "../pipeline/mtf-pipeline.ts";
import type { MarketDataProvenance } from "../providers/types.ts";
import type { KlyngeDecisionState } from "../triggers/types.ts";
import { chartFor } from "../visual/session.ts";
import type { ChartSession } from "../visual/session.ts";
import { OBSERVATION_FIELDS } from "../visual/types.ts";
import type { ChartRole, Provenance, VisualPolicy } from "../visual/types.ts";
import { evaluateVisualContext } from "../visual/visual-context.ts";
import type { VisualContextState } from "../visual/visual-context.ts";

export interface SnapshotField {
  value: unknown;
  provenance: Provenance;
}

export interface SnapshotSource {
  role: ChartRole;
  symbol: string | null;
  chartId?: string;
}

/** One canonical shape for both evidence modes. VISUAL fields keep their observed/confirmed provenance. */
export interface NormalizedSnapshot {
  snapshotId: string;
  evidenceMode: EvidenceMode;
  sessionId: string;
  targetSymbol: string | null;
  createdAt: number;
  sources: SnapshotSource[];
  fields: Record<string, SnapshotField>;
  captureTimes: Partial<Record<ChartRole, number>>;
  visual?: ChartSession;
  data?: Omit<MultiTimeframePipelineInput, "now" | "previous">;
  /** Provider provenance for DATA snapshots built from normalized provider feeds (absent for direct OHLCV import). */
  marketData?: MarketDataProvenance[];
}

export function buildVisualSnapshot(session: ChartSession, now: number): Readonly<NormalizedSnapshot> {
  const fields: Record<string, SnapshotField> = {};
  const captureTimes: Partial<Record<ChartRole, number>> = {};
  for (const c of session.charts) {
    captureTimes[c.role] = c.captureTime;
    for (const f of OBSERVATION_FIELDS) fields[`${c.role}.${f}`] = { value: c.observation[f].value, provenance: c.observation[f].status };
  }
  const target = chartFor(session, "TARGET");
  return deepFreeze({
    snapshotId: `${session.sessionId}:VISUAL:${now}`,
    evidenceMode: "VISUAL" as const,
    sessionId: session.sessionId,
    targetSymbol: (target?.observation.symbol.value as string | null | undefined) ?? null,
    createdAt: now,
    sources: session.charts.map((c) => ({ role: c.role, symbol: c.observation.symbol.value, chartId: c.chartId })),
    fields,
    captureTimes,
    visual: session,
  });
}

const lastCandle = (sessions: readonly { candles: Candle[] }[]) => sessions[sessions.length - 1]?.candles.at(-1);

export function buildDataSnapshot(
  sessionId: string,
  data: Omit<MultiTimeframePipelineInput, "now" | "previous">,
  now: number,
  opts: { snapshotId?: string; marketData?: readonly MarketDataProvenance[] } = {},
): Readonly<NormalizedSnapshot> {
  const t = lastCandle(data.target);
  const captureTimes: Partial<Record<ChartRole, number>> = {};
  const sources: SnapshotSource[] = [];
  for (const [role, feed] of [["TARGET", data.target], ["SPX", data.spx], ["MNQ", data.mnq], ["VOLUME_PROXY", data.volumeProxy ?? []]] as const) {
    const last = lastCandle(feed);
    if (last) {
      captureTimes[role] = last.timestamp;
      sources.push({ role, symbol: last.symbol });
    }
  }
  const fields: Record<string, SnapshotField> = {};
  if (t) {
    fields["TARGET.symbol"] = { value: t.symbol, provenance: "DATA_VERIFIED" };
    fields["TARGET.timeframe"] = { value: t.timeframe, provenance: "DATA_VERIFIED" };
    fields["TARGET.lastPrice"] = { value: t.close, provenance: "DATA_VERIFIED" };
  }
  return deepFreeze({
    snapshotId: opts.snapshotId ?? `${sessionId}:DATA:${now}`,
    evidenceMode: "DATA" as const,
    sessionId,
    targetSymbol: t?.symbol ?? null,
    createdAt: now,
    sources,
    fields,
    captureTimes,
    data,
    ...(opts.marketData ? { marketData: [...opts.marketData] } : {}),
  });
}

export type SnapshotEvaluation =
  | { evidenceMode: "VISUAL"; snapshotId: string; context: VisualContextState }
  | { evidenceMode: "DATA"; snapshotId: string; result: MultiTimeframePipelineResult };

/**
 * Router. DATA => the existing deterministic pipeline, unchanged. VISUAL => evaluateVisualContext.
 * A VISUAL snapshot can never reach the setup engine or options.
 */
export function evaluateSnapshot(snapshot: NormalizedSnapshot, opts: { now: number; previous?: KlyngeDecisionState; visualPolicy?: VisualPolicy }): Readonly<SnapshotEvaluation> {
  if (snapshot.evidenceMode === "VISUAL") {
    if (!snapshot.visual) throw new RangeError("VISUAL snapshot without a chart session");
    return deepFreeze({ evidenceMode: "VISUAL" as const, snapshotId: snapshot.snapshotId, context: evaluateVisualContext(snapshot.visual, opts.now, opts.visualPolicy) });
  }
  if (!snapshot.data) throw new RangeError("DATA snapshot without OHLCV input");
  const result = evaluateMultiTimeframeSetup({ ...snapshot.data, now: opts.now, ...(opts.previous ? { previous: opts.previous } : {}) });
  return deepFreeze({ evidenceMode: "DATA" as const, snapshotId: snapshot.snapshotId, result });
}
