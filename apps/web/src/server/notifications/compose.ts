import type { AlertEvent, StateAlert } from "../engine-core.ts";

/**
 * Notification content is built ONLY from the alert's event, symbol, mode and resulting state — fixed templates.
 * Never: thresholds, prices/levels, reasons text, screenshot contents, notes, account data or prompts.
 * Notifications describe an existing decision; they never create a signal.
 */
const LABEL: Record<AlertEvent, string> = {
  VISUAL_CONTEXT_COMPLETE: "visual context complete",
  VISUAL_CONTEXT_INCOMPLETE: "visual context incomplete",
  DATA_VERIFIED: "verified market data connected",
  RISK_ON: "market regime risk-on",
  RISK_OFF: "market regime risk-off",
  MIXED: "market regime mixed",
  SETUP_WAIT: "WAIT",
  CALL_SETUP: "CALL SETUP — conditions met",
  PUT_SETUP: "PUT SETUP — conditions met",
  BLOCKED: "BLOCKED",
  INVALIDATED: "INVALIDATED",
  OPTIONS_ELIGIBLE: "options eligibility changed",
  OPTIONS_BLOCKED: "options not eligible",
  PROVIDER_FAILURE: "market data unavailable",
};

const FOOTER = "Open Klynge to review the reasons and the risk context. Klynge is not financial advice. Trading involves substantial risk and you may lose 100% of the capital committed to a trade.";

export function composeNotification(a: StateAlert): { subject: string; text: string } {
  const symbol = /^[A-Z][A-Z0-9.^/_-]{0,11}$/.test(a.symbol) ? a.symbol : "Your analysis";
  const when = new Date(a.at).toISOString().replace(".000Z", "Z");
  const mode = a.evidenceMode === "VISUAL" ? "Visual analysis (observation only — data verification required)" : "Data analysis";
  return {
    subject: `Klynge · ${symbol}: ${LABEL[a.event]}`,
    text: `${symbol}: ${LABEL[a.event]}.\n${mode} · ${when}\n\n${FOOTER}`,
  };
}
