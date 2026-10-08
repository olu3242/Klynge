/**
 * Historical ingestion CLI (manual; never in CI). Real providers need server-only credentials and a license that
 * permits storage. Output goes to KLYNGE_DATASET_DIR (default .klynge/datasets — gitignored).
 *   node --conditions=react-server scripts/history-ingest.ts --provider polygon --symbol SPX --from 2026-09-01 --to 2026-09-30 [--tf 5m]
 */
import path from "node:path";
import { nyseCalendar, cmeEquityIndexCalendar, toProviderSymbol } from "../src/server/engine-core.ts";
import { DatasetStore, ingestHistory } from "../src/server/history/pipeline.ts";
import { polygonMarketData } from "../src/server/market-data.ts";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const provider = arg("provider");
const symbol = (arg("symbol") ?? "").toUpperCase();
const from = Date.parse(`${arg("from")}T00:00:00Z`);
const to = Date.parse(`${arg("to")}T23:59:59Z`);
if (provider !== "polygon" || !symbol || !Number.isFinite(from) || !Number.isFinite(to)) {
  console.error("usage: --provider polygon --symbol SPX|TSLA|... --from YYYY-MM-DD --to YYYY-MM-DD");
  process.exit(2);
}
if (!process.env.POLYGON_API_KEY) {
  console.error("BLOCKED: POLYGON_API_KEY is not configured (server-only). Live historical ingestion cannot run.");
  process.exit(3);
}
const setup = polygonMarketData(process.env);
const providerSymbol = toProviderSymbol(setup.symbolMap, symbol);
if (!providerSymbol) {
  console.error(`BLOCKED: ${symbol} has no licensed ${setup.symbolMap.provider} symbol`);
  process.exit(3);
}
const store = new DatasetStore(path.resolve(process.env.KLYNGE_DATASET_DIR ?? ".klynge/datasets"));
const r = await ingestHistory({
  provider: setup.provider,
  plan: { role: symbol === "SPX" ? "SPX" : symbol === "MNQ" ? "MNQ" : "TARGET", canonicalSymbol: symbol, providerSymbol },
  timeframe: (arg("tf") ?? "5m") as "5m",
  calendar: symbol === "MNQ" ? cmeEquityIndexCalendar() : nyseCalendar(),
  from,
  to,
  kind: "HISTORICAL",
  license: { terms: process.env.KLYNGE_DATA_LICENSE ?? "operator-accepted vendor terms (record reference here)", retentionDays: process.env.KLYNGE_DATA_RETENTION_DAYS ? Number(process.env.KLYNGE_DATA_RETENTION_DAYS) : null, redistribution: false },
  acquiredAt: Date.now(),
  store,
});
console.log(JSON.stringify({ datasetId: r.manifest.datasetId, clean: r.manifest.clean, bars: r.manifest.bars, issues: r.issues.length, corrections: r.corrections.length, failure: r.failure ?? null }, null, 2));
