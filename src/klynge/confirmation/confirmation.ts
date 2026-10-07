import type { VolumeClass } from "../domain/types.ts";
import { classifyVolume } from "../indicators/volume.ts";
import type { PriceActionLifecycle } from "../price-action/types.ts";

export type ConfirmationState = "PENDING" | "PARTIAL" | "CONFIRMED" | "FAILED";

/** Volume never gates structure; it only grades a structurally confirmed setup. Not a score. */
export type ConfirmationQuality = "STANDARD" | "HIGH";

export interface ConfirmationInput {
  marketPermissionEnabled: boolean;
  targetAligned: boolean;
  levelValid: boolean;
  lifecycle?: PriceActionLifecycle;
  /** Relative volume of the continuation candle (target's own volume), if computable. */
  continuationVolumeRatio?: number | null;
}

export interface ConfirmationResult {
  state: ConfirmationState;
  quality?: ConfirmationQuality;
  volumeClass?: VolumeClass;
  met: string[];
  missing: string[];
}

/**
 * ALL conditions are mandatory — no weighting, no voting:
 * market permission ENABLED, target aligned, valid level, break, acceptance, retest, continuation close, no invalidation.
 */
export function evaluateConfirmation(input: ConfirmationInput): ConfirmationResult {
  const lc = input.lifecycle;
  const checks: [string, boolean][] = [
    ["Market permission enabled", input.marketPermissionEnabled],
    ["Target direction aligned with regime", input.targetAligned],
    ["Valid level context", input.levelValid],
    ["Break complete", lc !== undefined],
    ["Acceptance complete", lc?.acceptedAt !== undefined],
    ["Valid retest", lc?.retestStartedAt !== undefined],
    ["Continuation close", lc?.continuationIndex !== undefined],
    ["No invalidation", lc === undefined || (lc.state !== "FAILED" && lc.state !== "INVALIDATED")],
  ];
  const met = checks.filter(([, ok]) => ok).map(([name]) => name);
  const missing = checks.filter(([, ok]) => !ok).map(([name]) => name);

  if (lc && (lc.state === "FAILED" || lc.state === "INVALIDATED")) return { state: "FAILED", met, missing };
  if (missing.length === 0) {
    const ratio = input.continuationVolumeRatio;
    if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return { state: "CONFIRMED", quality: "STANDARD", met, missing };
    const volumeClass = classifyVolume(ratio);
    return { state: "CONFIRMED", quality: volumeClass === "STRONG" || volumeClass === "CONFIRMING" ? "HIGH" : "STANDARD", volumeClass, met, missing };
  }
  if (lc?.retestStartedAt !== undefined) return { state: "PARTIAL", met, missing };
  return { state: "PENDING", met, missing };
}
