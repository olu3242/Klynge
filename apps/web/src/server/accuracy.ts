import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_VISUAL_POLICY, isUsable, OBSERVATION_FIELDS, validateObservation } from "./engine-core.ts";
import type { ObservationField, VisualPolicy } from "./engine-core.ts";

export interface FieldScore {
  field: ObservationField;
  correct: number;
  wrong: number;
  /** Extractor abstained (NOT_VISIBLE / NOT_VERIFIED) — safe, but not useful. */
  abstained: number;
  /** Golden says not visible and extractor agreed. */
  correctlyAbsent: number;
}

export interface CalibrationBucket {
  range: string;
  claims: number;
  accuracy: number | null;
}

export interface AccuracyReport {
  provider: string;
  images: number;
  fields: FieldScore[];
  overall: { correct: number; wrong: number; abstained: number; precision: number | null };
  calibration: CalibrationBucket[];
  /** Confident errors that passed validation — the dangerous class. */
  confidentErrors: { image: string; field: ObservationField; observed: unknown; golden: unknown }[];
}

const same = (a: unknown, b: unknown, field: ObservationField) => {
  if (field === "lastPrice" && typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= Math.max(0.01, Math.abs(b) * 0.0005);
  return JSON.stringify(a) === JSON.stringify(b);
};

/** Score recorded extractor outputs against golden labels, after the engine's deterministic validation. */
export function scoreCorpus(corpusDir: string, provider: string, policy: VisualPolicy = DEFAULT_VISUAL_POLICY): AccuracyReport {
  const goldenDir = path.join(corpusDir, "golden");
  const recDir = path.join(corpusDir, "recorded", provider);
  const ids = readdirSync(goldenDir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
  const scores = new Map<ObservationField, FieldScore>(OBSERVATION_FIELDS.map((f) => [f, { field: f, correct: 0, wrong: 0, abstained: 0, correctlyAbsent: 0 }]));
  const claims: { confidence: number; correct: boolean }[] = [];
  const confidentErrors: AccuracyReport["confidentErrors"] = [];
  let images = 0;
  for (const id of ids) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path.join(recDir, `${id}.json`), "utf8"));
    } catch {
      continue;
    }
    images++;
    const golden = JSON.parse(readFileSync(path.join(goldenDir, `${id}.json`), "utf8")) as Record<string, unknown>;
    const { observation } = validateObservation(raw, policy);
    for (const field of OBSERVATION_FIELDS) {
      const s = scores.get(field) as FieldScore;
      const f = observation[field];
      const truth = golden[field] ?? null;
      if (!isUsable(f.status)) {
        if (truth === null) s.correctlyAbsent++;
        else s.abstained++;
        continue;
      }
      const ok = truth !== null && same(f.value, truth, field);
      if (ok) s.correct++;
      else {
        s.wrong++;
        confidentErrors.push({ image: id, field, observed: f.value, golden: truth });
      }
      claims.push({ confidence: f.confidence, correct: ok });
    }
  }
  const all = [...scores.values()];
  const correct = all.reduce((n, s) => n + s.correct, 0);
  const wrong = all.reduce((n, s) => n + s.wrong, 0);
  const buckets: [number, number][] = [
    [0.7, 0.8],
    [0.8, 0.9],
    [0.9, 1.0001],
  ];
  return {
    provider,
    images,
    fields: all,
    overall: { correct, wrong, abstained: all.reduce((n, s) => n + s.abstained, 0), precision: correct + wrong ? correct / (correct + wrong) : null },
    calibration: buckets.map(([lo, hi]) => {
      const inB = claims.filter((c) => c.confidence >= lo && c.confidence < hi);
      return { range: `${lo.toFixed(1)}–${Math.min(hi, 1).toFixed(1)}`, claims: inB.length, accuracy: inB.length ? inB.filter((c) => c.correct).length / inB.length : null };
    }),
    confidentErrors,
  };
}
