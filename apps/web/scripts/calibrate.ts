/**
 * Offline calibration + backtest report (manual). Uses the recorded SYNTHETIC fixture unless --datasets points at a
 * DatasetStore with HISTORICAL manifests for TARGET, SPX and MNQ. Reports are descriptive; nothing changes policy.
 *   node --conditions=react-server scripts/calibrate.ts [--out .klynge/reports]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runBacktest, sensitivitySweep } from "../src/server/engine-core.ts";
import type { TradingSession } from "../src/server/engine-core.ts";

const out = path.resolve(process.argv[process.argv.indexOf("--out") + 1] && process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1]! : ".klynge/reports");
mkdirSync(out, { recursive: true });
const f = JSON.parse(readFileSync(path.join(import.meta.dirname, "../test/fixtures/ohlcv-call.json"), "utf8")) as { target: TradingSession[]; spx: TradingSession[]; mnq: TradingSession[]; timeframePolicy: never };
const input = { target: f.target, spx: f.spx, mnq: f.mnq, timeframePolicy: f.timeframePolicy };
const datasets = [{ name: "ohlcv-call-fixture", source: "SYNTHETIC" as const, input }];
const sweeps = (["minimumRewardRiskRatio", "maximumStopAtr", "acceptanceCloses"] as const).map((p) =>
  sensitivitySweep(datasets, p, p === "acceptanceCloses" ? [1, 3] : p === "maximumStopAtr" ? [1, 3] : [1.5, 3]),
);
const backtest = runBacktest([{ name: "ohlcv-call-fixture", kind: "SYNTHETIC", input, historySessions: f.target.length - 1 }]);
writeFileSync(path.join(out, "calibration.json"), JSON.stringify(sweeps, null, 2));
writeFileSync(path.join(out, "backtest.json"), JSON.stringify({ ...backtest, trades: backtest.trades.slice(0, 200) }, null, 2));
console.log(JSON.stringify({ evidence: backtest.evidence, frames: backtest.frames, setups: backtest.setups, trades: backtest.overall.trades, insufficientSample: backtest.overall.insufficientSample, sweeps: sweeps.map((s) => ({ parameter: s.parameter, rows: s.rows.length, evidence: s.evidence })) }, null, 2));
