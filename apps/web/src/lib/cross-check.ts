import type { WorkspaceView } from "./view-model";

export interface CrossCheck {
  status: "AWAITING_CHART" | "AWAITING_DATA" | "MATCH" | "CONFLICT";
  issues: string[];
  visualSymbol: string | null;
  verifiedSymbol: string | null;
  /** Comparison is informational; it never changes a canonical DATA engine decision. */
  permitsVisualTradeSetup: false;
}

/** Conservative client-facing comparison; never upgrades chart evidence to DATA. */
export function crossCheckWorkspace(view: WorkspaceView, requestedTicker: string): CrossCheck {
  const target = view.charts.find((chart) => chart.role === "TARGET");
  const visualSymbol = target?.symbol?.trim().toUpperCase() || null;
  const verifiedSymbol = view.data?.symbol?.trim().toUpperCase() || null;
  const requested = requestedTicker.trim().toUpperCase();
  if (!target) return { status: "AWAITING_CHART", issues: ["Upload a target chart to compare with verified market data."], visualSymbol, verifiedSymbol, permitsVisualTradeSetup: false };
  if (!verifiedSymbol || view.runtime?.status === "BLOCKED" || view.runtime?.status === "WAIT") return {
    status: "AWAITING_DATA",
    issues: ["Verified market data is unavailable or blocked. Chart observations remain VISUAL only."],
    visualSymbol, verifiedSymbol, permitsVisualTradeSetup: false,
  };
  const issues: string[] = [];
  if (!visualSymbol) issues.push("Chart symbol is not verified; confirm it before comparing.");
  if (visualSymbol && visualSymbol !== verifiedSymbol) issues.push(`Chart symbol ${visualSymbol} differs from verified ticker ${verifiedSymbol}.`);
  if (requested && requested !== verifiedSymbol) issues.push(`Requested ticker ${requested} differs from verified ticker ${verifiedSymbol}.`);
  const tf = target.fields.find((f) => f.field === "timeframe");
  if (!tf?.value || tf.status === "NOT_VERIFIED" || tf.status === "NOT_VISIBLE") issues.push("Chart timeframe is not verified.");
  else if (tf.value.toLowerCase() !== view.data?.timeframe?.toLowerCase()) issues.push(`Chart timeframe ${tf.value} differs from data timeframe ${view.data?.timeframe}.`);
  if (target.roleViolation) issues.push(target.roleViolation);
  if (target.issues.length) issues.push("Chart extraction has unresolved issues.");
  if (view.visual?.blockers.length) issues.push("Visual context contains blockers.");
  return { status: issues.length ? "CONFLICT" : "MATCH", issues, visualSymbol, verifiedSymbol, permitsVisualTradeSetup: false };
}
