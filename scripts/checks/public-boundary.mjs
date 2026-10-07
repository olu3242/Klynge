/**
 * PUBLIC / PRODUCT / INTERNAL boundary enforcement (see docs/policies/public-boundary.md).
 * Scans every public-facing source file for engine-IP leakage, banned marketing language,
 * and required risk disclosures. Fails the lint step on any violation.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PUBLIC_ROOTS = ["index.html", "styles", "js", "public"];
const TEXT_EXT = new Set([".html", ".css", ".js", ".svg", ".json", ".md", ".txt"]);

/** Internal engine IP that must never appear on public surfaces. */
const IP_PATTERNS = [
  [/\bEMA\s*-?\s*9\b|\bEMA9\b/i, "EMA9 indicator"],
  [/\bATR\s*-?\s*14\b|\bATR14\b/i, "ATR14 indicator"],
  [/\bVWAP\b/i, "VWAP"],
  [/HH_HL|LH_LL|higher highs?\s*(and|\/|\+)\s*higher lows?/i, "structure classification"],
  [/\bSPX\b|\bMNQ\b/, "regime instruments"],
  [/timestamp[\s-]*skew|snapshot[\s-]*skew|maxMarketSnapshotSkewMs/i, "timestamp-skew policy"],
  [/tradeAllowed|evaluateTradePermission|TradePermission|isDirectionallyEligible/, "permission internals"],
  [/\bretest\b|break\s*(→|->|,|\+)\s*acceptance/i, "break/acceptance/retest logic"],
  [/options[\s-]*selection|strike selection|delta\s*target/i, "options-selection logic"],
  [/system prompt|agent prompt|you are (the )?klynge/i, "agent prompts"],
  [/minimumTechnicalCandles|maxStalenessMs|KLYNGE_RULE_VERSION|market-truth-v\d/, "engine policy/config"],
  [/relative volume|volumeRatio|swing (high|low)s?\b/i, "indicator internals"],
  [/docs\/architecture|src\/klynge/, "link to internal docs/source"],
  // setup-engine-v1 internals
  [/\bacceptance\b|required closes|sustained closes/i, "acceptance rule"],
  [/(support|resistance)[\s/-]*(cluster|clustering)|level[\s-]*cluster|touch(es)?[\s-]*tolerance|ATR[\s-]*tolerance/i, "level-clustering formula"],
  [/break[\s-]*(threshold|distance)|close[\s-]*distance|closes? (above|below) (resistance|support)/i, "break threshold"],
  [/retest[\s-]*(tolerance|depth)|\bretest(ing|ed)?\b/i, "retest logic"],
  [/reward[\s/:-]*(to[\s-]*)?risk|risk[\s/:-]*(to[\s-]*)?reward|\bR:R\b|\bR\/R\b/i, "reward/risk mechanics"],
  [/entry[\s-]*zone|stop[\s-]*(distance|algorithm|placement)|structural invalidation|invalidation (price|tolerance|level)/i, "stop/entry algorithm"],
  [/next (valid |meaningful )?(resistance|support)|target[\s-]*selection/i, "target-selection mechanics"],
  [/state[\s-]*machine|state[\s-]*transition|PriceActionState|LEGAL_TRANSITIONS|setup-engine-v\d/i, "state-transition logic"],
  [/minimumRewardRiskRatio|maximumStopAtr|requiredCloses|minimumCloseDistanceAtr|atrToleranceMultiplier|maximumFailureDistanceAtr|entryToleranceAtr|invalidationToleranceAtr|volumeProxySymbol/, "setup policy/config"],
];

/** Language Klynge never uses publicly. */
const BANNED = [
  [/\bguaranteed?\s+(profit|returns?|results?|wins?|gains?|trades?)\b/i, "guarantee claim"],
  [/\bguaranteed\b/i, "guaranteed"],
  [/\bsafe trades?\b/i, "safe trade"],
  [/\bcan'?t miss\b|\bcannot miss\b/i, "can't miss"],
  [/\bbuy now\b/i, "buy now"],
  [/\bsell now\b/i, "sell now"],
  [/\bsure win\b|\bnever lose\b|\bbeat the market\b/i, "outcome promise"],
];

const REQUIRED_IN_INDEX = [
  "Klynge is not financial advice.",
  "Trading involves substantial risk and you may lose 100% of the capital committed to a trade.",
  "Klynge is a market-risk analysis and educational decision-support platform. Klynge does not provide investment, financial, legal, tax, or trading advice. Trading stocks, options, futures, leveraged products, and other financial instruments involves substantial risk. Users may lose some or all capital committed to a trade, including 100%. Klynge evaluates market conditions and risk but cannot predict or guarantee future outcomes. Users remain responsible for their own decisions.",
];

function walk(p, out = []) {
  const abs = join(ROOT, p);
  if (statSync(abs).isDirectory()) for (const f of readdirSync(abs)) walk(join(p, f), out);
  else out.push(p);
  return out;
}

const files = PUBLIC_ROOTS.flatMap((p) => walk(p));
const violations = [];

for (const f of files) {
  if (/\.(ts|mts|cts)$/.test(f)) violations.push(`${f}: TypeScript source in public tree`);
  if (!TEXT_EXT.has(extname(f))) continue;
  const text = readFileSync(join(ROOT, f), "utf8");
  // Brand-kit README legitimately contains the compact disclosure; still scanned like everything else.
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    for (const [re, label] of [...IP_PATTERNS, ...BANNED]) {
      if (re.test(line)) violations.push(`${f}:${i + 1}: ${label} — "${line.trim().slice(0, 120)}"`);
    }
  });
}

const index = readFileSync(join(ROOT, "index.html"), "utf8").replace(/\s+/g, " ");
for (const req of REQUIRED_IN_INDEX) if (!index.includes(req)) violations.push(`index.html: missing required disclosure "${req.slice(0, 60)}…"`);

if (violations.length) {
  console.error(`public-boundary FAILED (${violations.length}):\n  ` + violations.join("\n  "));
  process.exit(1);
}
console.log(`public-boundary OK (${files.length} public files scanned)`);
