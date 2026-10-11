import assert from "node:assert/strict";
import test from "node:test";
import { crossCheckWorkspace } from "./cross-check";
import type { WorkspaceView } from "./view-model";

const now = Date.now();
function fixture(): WorkspaceView {
  return {
    sessionId: "s",
    charts: [{ chartId: "c", role: "TARGET", roleSource: "DETECTED", roleViolation: null, symbol: "TSLA",
      captureTime: now, captureTimeSource: "UPLOAD", confirmations: 0, issues: [],
      fields: [{ field: "timeframe", label: "Timeframe", value: "5m", status: "OBSERVED", confidence: 0.95, required: true, editable: true }] }],
    completeness: [], visual: null,
    data: { evidenceMode: "DATA", symbol: "TSLA", timeframe: "5m", decision: "WAIT", regime: "MIXED", targetDirection: "NEUTRAL",
      priceActionState: null, confirmationState: null, progress: [], summary: "", reasons: [], blockers: [], missing: [], invalidatesIf: [],
      risk: null, asOf: now, source: "PROVIDER", provenance: [], options: null, userPolicy: null },
    latestRecordId: null, alerts: [], journal: [],
    evidence: { mode: "DATA", title: "", detail: "", changedFrom: "VISUAL" },
    account: { kind: "USER", email: null, authEnabled: true, promotionAvailable: false, dataAvailable: true, origin: "DIRECT" },
    runtime: { status: "DATA_VERIFIED", title: "", symbol: "TSLA", reasons: [], previousRestored: false, marketTimestamp: now },
  };
}
test("matching chart and verified ticker remains informational only", () => {
  const result = crossCheckWorkspace(fixture(), "TSLA");
  assert.equal(result.status, "MATCH");
  assert.equal(result.permitsVisualTradeSetup, false);
});
test("symbol mismatch produces conflict", () => {
  const view = fixture(); view.charts[0]!.symbol = "AMD";
  assert.equal(crossCheckWorkspace(view, "TSLA").status, "CONFLICT");
});
test("timeframe mismatch produces conflict", () => {
  const view = fixture(); view.data!.timeframe = "15m";
  assert.equal(crossCheckWorkspace(view, "TSLA").status, "CONFLICT");
});
test("unverified runtime cannot match", () => {
  const view = fixture(); view.runtime!.status = "WAIT";
  assert.equal(crossCheckWorkspace(view, "TSLA").status, "AWAITING_DATA");
});
test("no chart cannot match", () => {
  const view = fixture(); view.charts = [];
  assert.equal(crossCheckWorkspace(view, "TSLA").status, "AWAITING_CHART");
});
test("old chart cannot match", () => {
  const view = fixture(); view.charts[0]!.captureTime = now - 20 * 60_000;
  assert.equal(crossCheckWorkspace(view, "TSLA").status, "CONFLICT");
});
