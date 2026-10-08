/**
 * Offline calibration + out-of-sample report (manual; never in CI). Without --datasets it runs the recorded SYNTHETIC
 * fixture (harness check only — labelled SYNTHETIC_NOT_EMPIRICAL). With --datasets it uses only clean HISTORICAL
 * manifests (latest version) from a DatasetStore for --target, SPX and MNQ. The holdout is sealed before analysis;
 * sensitivity sweeps run on the pre-holdout view only. Reports are descriptive; nothing changes policy.
 *   node --conditions=react-server scripts/calibrate.ts [--datasets .klynge/datasets --target TSLA --tf 5m] [--out .klynge/reports]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { calibrationView, outOfSampleReport, replayDays, sealHoldout, sensitivitySweep } from "../src/server/engine-core.ts";
import type { BacktestDataset, DatasetManifest, TradingSession } from "../src/server/engine-core.ts";
import { DatasetStore } from "../src/server/history/pipeline.ts";

const arg = (k: string) => (process.argv.includes(`--${k}`) ? process.argv[process.argv.indexOf(`--${k}`) + 1] : undefined);
const out = path.resolve(arg("out") ?? ".klynge/reports");
mkdirSync(out, { recursive: true });
const f = JSON.parse(readFileSync(path.join(import.meta.dirname, "../test/fixtures/ohlcv-call.json"), "utf8")) as { target: TradingSession[]; spx: TradingSession[]; mnq: TradingSession[]; timeframePolicy: never };

function historical(dir: string, target: string, tf: string): BacktestDataset {
  const store = new DatasetStore(path.resolve(dir));
  const pick = (sym: string): DatasetManifest => {
    const m = store.manifests().filter((x) => x.kind === "HISTORICAL" && x.clean && x.canonicalSymbol === sym && x.timeframe === tf).sort((a, b) => (a.version ?? 1) - (b.version ?? 1) || a.acquiredAt - b.acquiredAt).at(-1);
    if (!m) {
      console.error(`BLOCKED: no clean HISTORICAL ${sym} ${tf} dataset in ${dir}. Synthetic fixtures are never empirical evidence.`);
      process.exit(3);
    }
    if (!store.verify(m.datasetId).ok) {
      console.error(`BLOCKED: ${m.datasetId} fails hash verification`);
      process.exit(3);
    }
    return m;
  };
  const [t, s, n] = [pick(target), pick("SPX"), pick("MNQ")];
  const input = { target: store.normalized(t.datasetId), spx: store.normalized(s.datasetId), mnq: store.normalized(n.datasetId), timeframePolicy: f.timeframePolicy };
  return { name: `${target}:${t.datasetId}`, kind: "HISTORICAL", input, historySessions: Math.min(20, Math.max(1, input.target.length - 5)) };
}

const dir = arg("datasets");
const ds: BacktestDataset = dir ? historical(dir, (arg("target") ?? "").toUpperCase(), arg("tf") ?? "5m") : { name: "ohlcv-call-fixture", kind: "SYNTHETIC", input: { target: f.target, spx: f.spx, mnq: f.mnq, timeframePolicy: f.timeframePolicy }, historySessions: Math.max(1, f.target.length - 5) };
const days = replayDays([ds]);
const seal = sealHoldout(days.map((d) => d.day), Date.now());
const calib = calibrationView(ds, seal);
const calibDatasets = [{ name: calib.name, source: calib.kind, input: calib.input }];
const sweeps = (["minimumRewardRiskRatio", "maximumStopAtr", "acceptanceCloses"] as const).map((p) => sensitivitySweep(calibDatasets, p, p === "acceptanceCloses" ? [1, 3] : p === "maximumStopAtr" ? [1, 3] : [1.5, 3]));
const oos = outOfSampleReport(days, seal);
writeFileSync(path.join(out, "calibration.json"), JSON.stringify({ sealHash: seal.sealHash, calibratedOn: "TRAIN+VALIDATION only", sweeps }, null, 2));
writeFileSync(path.join(out, "out-of-sample.json"), JSON.stringify(oos, null, 2));
console.log(JSON.stringify({ evidence: oos.evidence, days: days.length, seal: { holdoutDays: seal.holdoutDays, sealHash: seal.sealHash }, trades: oos.underlying.trades, holdoutInsufficient: oos.uncertainty.holdoutInsufficient, significance: oos.significance.status, options: oos.options.status, sweeps: sweeps.map((s) => ({ parameter: s.parameter, rows: s.rows.length, evidence: s.evidence })) }, null, 2));
