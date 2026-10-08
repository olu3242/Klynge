/**
 * Historical ingestion CLI (manual; never in CI). Real providers need server-only credentials and a license that
 * permits storage. Output goes to KLYNGE_DATASET_DIR (default .klynge/datasets — gitignored).
 *   node --conditions=react-server scripts/history-ingest.ts --provider polygon --symbol SPX --from 2026-09-01 --to 2026-09-30 [--tf 5m]
 *   node --conditions=react-server scripts/history-ingest.ts --provider databento --symbol MNQ --from 2026-09-01 --to 2026-09-30 [--tf 1m]
 * MNQ is always the CME micro (front contract, rolled per manifest). NQ is never substituted for MNQ, SPY never for SPX.
 * Vendor gaps are inventoried, never filled; a gapped range normalizes to nothing (fail closed).
 */
import path from "node:path";
import { nyseCalendar, cmeEquityIndexCalendar, toProviderSymbol } from "../src/server/engine-core.ts";
import { DatasetStore, ingestHistory } from "../src/server/history/pipeline.ts";
import { polygonMarketData } from "../src/server/market-data.ts";
import { CmeFuturesProvider } from "../src/server/providers/cme-futures.ts";
import { DatabentoBarsSource } from "../src/server/providers/databento.ts";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const TIMEFRAMES = ["1m", "5m", "15m", "1h", "1d"] as const;
type Tf = (typeof TIMEFRAMES)[number];
const provider = arg("provider");
const symbol = (arg("symbol") ?? "").toUpperCase();
const tf = (arg("tf") ?? "5m") as Tf;
const from = Date.parse(`${arg("from")}T00:00:00Z`);
const to = Date.parse(`${arg("to")}T23:59:59Z`);
if ((provider !== "polygon" && provider !== "databento") || !symbol || !TIMEFRAMES.includes(tf) || !Number.isFinite(from) || !Number.isFinite(to)) {
  console.error("usage: --provider polygon|databento --symbol SPX|MNQ|TSLA|... --from YYYY-MM-DD --to YYYY-MM-DD [--tf 1m|5m|15m|1h|1d]");
  process.exit(2);
}
if (provider === "databento" && symbol !== "MNQ") {
  console.error("databento ingestion is CME futures only (MNQ). Use --provider polygon for SPX/equities.");
  process.exit(2);
}
const keyName = provider === "databento" ? "DATABENTO_API_KEY" : "POLYGON_API_KEY";
if (!process.env[keyName]) {
  console.error(`BLOCKED: ${keyName} is not configured (server-only). Live historical ingestion cannot run.`);
  process.exit(3);
}
const cme = cmeEquityIndexCalendar();
const datasets = (process.env.KLYNGE_DATABENTO_DATASETS ?? "").split(",").map((d) => d.trim()).filter(Boolean);
const setup =
  provider === "databento"
    ? { provider: new CmeFuturesProvider({ source: new DatabentoBarsSource({ apiKey: process.env.DATABENTO_API_KEY!, licensedDatasets: datasets }), calendar: cme, roots: { "CME:MNQ": "MNQ" } }), providerSymbol: "CME:MNQ" }
    : (() => {
        const p = polygonMarketData(process.env);
        return { provider: p.provider, providerSymbol: toProviderSymbol(p.symbolMap, symbol) };
      })();
const providerSymbol = setup.providerSymbol;
if (!providerSymbol) {
  console.error(`BLOCKED: ${symbol} has no licensed ${provider} symbol`);
  process.exit(3);
}
const store = new DatasetStore(path.resolve(process.env.KLYNGE_DATASET_DIR ?? ".klynge/datasets"));
const r = await ingestHistory({
  provider: setup.provider,
  plan: { role: symbol === "SPX" ? "SPX" : symbol === "MNQ" ? "MNQ" : "TARGET", canonicalSymbol: symbol, providerSymbol },
  timeframe: tf,
  calendar: symbol === "MNQ" ? cme : nyseCalendar(),
  from,
  to,
  kind: "HISTORICAL",
  license: { terms: process.env.KLYNGE_DATA_LICENSE ?? "operator-accepted vendor terms (record reference here)", retentionDays: process.env.KLYNGE_DATA_RETENTION_DAYS ? Number(process.env.KLYNGE_DATA_RETENTION_DAYS) : null, redistribution: false },
  acquiredAt: Date.now(),
  store,
});
console.log(JSON.stringify({ datasetId: r.manifest.datasetId, version: r.manifest.version ?? 1, supersedes: r.manifest.supersedes ?? null, contract: r.manifest.contract ?? null, adjustment: r.manifest.adjustment ?? null, clean: r.manifest.clean, bars: r.manifest.bars, issues: r.issues.length, corrections: r.corrections.length, failure: r.failure ?? null }, null, 2));
