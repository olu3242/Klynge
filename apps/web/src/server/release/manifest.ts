import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import * as engine from "../engine-core.ts";

/**
 * Release governance (Batch 79). A release manifest pins engine, rule, app, schema and provider-adapter versions plus a
 * fingerprint of every deterministic policy default. Readiness is computed, never assumed: a policy change needs a
 * named human approval and a new rule version; deployment and each migration are authorized SEPARATELY; nothing here
 * deploys, migrates or changes policy.
 */
export const ADAPTER_VERSIONS = Object.freeze({
  polygon: "polygon-aggregates-v1",
  databento: "databento-glbx-ohlcv-1m-v1",
  cmeFutures: "cme-front-contract-v1",
  resend: "resend-emails-v1",
  extractor: "claude-chart-observations-v1",
});

const POLICY_NAMES = [
  "DEFAULT_DATA_QUALITY_POLICY",
  "DEFAULT_MARKET_CONTEXT_POLICY",
  "DEFAULT_LEVEL_POLICY",
  "DEFAULT_BREAK_POLICY",
  "DEFAULT_ACCEPTANCE_POLICY",
  "DEFAULT_RISK_POLICY",
  "DEFAULT_SETUP_POLICY",
  "DEFAULT_TIMEFRAME_POLICY",
  "DEFAULT_TIMEFRAME_SYNC_POLICY",
  "DEFAULT_MULTI_TIMEFRAME_SETUP_POLICY",
  "DEFAULT_OPTIONS_POLICY",
  "DEFAULT_VISUAL_POLICY",
  "DEFAULT_NORMALIZATION_POLICY",
  "DEFAULT_USER_RISK_POLICY",
] as const;

/** SHA-256 over the canonical JSON of every deterministic policy default (server-only; never shipped to browsers). */
export function policyFingerprint(): string {
  const all = Object.fromEntries(POLICY_NAMES.map((n) => [n, (engine as unknown as Record<string, unknown>)[n]]));
  return engine.sha256Hex(engine.canonicalJson(all));
}

export interface ReleaseManifest {
  manifestVersion: 1;
  release: string;
  engineVersion: string;
  ruleVersion: string;
  appVersion: string;
  previousRelease: string | null;
  schema: { migrations: { file: string; sha256: string; rollback: string; rollbackSha256: string }[] };
  adapters: Record<string, string>;
  policyFingerprint: string;
  policyChange: { proposalId: string; approvedBy: string; approvedAt: string; newRuleVersion: string } | null;
  approvals: { role: "ENGINEERING" | "OPERATIONS" | "RISK_POLICY"; name: string; at: string }[];
  authorizations: { deployment: { approved: boolean; by: string | null; at: string | null }; migrations: { file: string; project: string; approvedBy: string; at: string }[] };
  rollback: { to: string | null; procedure: string };
  /** Free-text provenance note (e.g. a manifest recorded retroactively). */
  note?: string;
}

export interface ActualState {
  engineVersion: string;
  ruleVersion: string;
  appVersion: string;
  migrations: { file: string; sha256: string; rollback: string | null; rollbackSha256: string | null }[];
  adapters: Record<string, string>;
  policyFingerprint: string;
}

const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

export function actualState(appRoot: string): ActualState {
  const dir = path.join(appRoot, "supabase/migrations");
  const rb = path.join(appRoot, "supabase/rollback");
  const migrations = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => {
      const r = file.replace(/\.sql$/, ".down.sql");
      const has = existsSync(path.join(rb, r));
      return { file, sha256: sha(path.join(dir, file)), rollback: has ? r : null, rollbackSha256: has ? sha(path.join(rb, r)) : null };
    });
  const appVersion = (JSON.parse(readFileSync(path.join(appRoot, "package.json"), "utf8")) as { version: string }).version;
  return { engineVersion: engine.KLYNGE_ENGINE_VERSION, ruleVersion: engine.KLYNGE_RULE_VERSION, appVersion, migrations, adapters: { ...ADAPTER_VERSIONS }, policyFingerprint: policyFingerprint() };
}

const HUMAN = (name: string) => name.trim().length >= 3 && !/bot|claude|agent|automation|\bci\b|github-actions|system/i.test(name);

export interface ReadinessCheck {
  id: string;
  ok: boolean;
  detail: string;
}
export type ReleaseVerdict = "BLOCKED" | "READY_FOR_APPROVAL" | "APPROVED_FOR_DEPLOYMENT";

export function releaseReadiness(m: ReleaseManifest, previous: ReleaseManifest | null, a: ActualState): { verdict: ReleaseVerdict; checks: ReadinessCheck[]; pendingMigrations: string[] } {
  const checks: ReadinessCheck[] = [];
  const add = (id: string, ok: boolean, detail: string) => checks.push({ id, ok, detail });
  add("versions.engine", m.engineVersion === a.engineVersion && m.release === a.engineVersion, `manifest ${m.engineVersion} / code ${a.engineVersion}`);
  add("versions.rule", m.ruleVersion === a.ruleVersion, `manifest ${m.ruleVersion} / code ${a.ruleVersion}`);
  add("versions.app", m.appVersion === a.appVersion, `manifest ${m.appVersion} / code ${a.appVersion}`);
  add("adapters", JSON.stringify(m.adapters) === JSON.stringify(a.adapters), "provider adapter versions pinned");
  const files = a.migrations.map((x) => x.file);
  add("schema.files", JSON.stringify(m.schema.migrations.map((x) => x.file)) === JSON.stringify(files), `${files.length} migrations`);
  for (const x of a.migrations) {
    const pinned = m.schema.migrations.find((y) => y.file === x.file);
    add(`schema.hash:${x.file}`, pinned?.sha256 === x.sha256 && pinned.rollbackSha256 === x.rollbackSha256, pinned ? "pinned" : "not in manifest");
    add(`schema.rollback:${x.file}`, x.rollback !== null, x.rollback ?? "missing rollback");
  }
  add("policy.fingerprint", m.policyFingerprint === a.policyFingerprint, "deterministic policy defaults match the manifest");
  const policyChanged = previous !== null && previous.policyFingerprint !== m.policyFingerprint;
  if (policyChanged) {
    const pc = m.policyChange;
    add("policy.change-approved", !!pc && HUMAN(pc.approvedBy) && pc.newRuleVersion === m.ruleVersion && m.ruleVersion !== previous.ruleVersion, pc ? `approved by a named human, rule ${pc.newRuleVersion}` : "policy defaults changed without an approved proposal");
    add("policy.risk-approval", m.approvals.some((x) => x.role === "RISK_POLICY" && HUMAN(x.name)), "RISK_POLICY sign-off required for a policy change");
  } else add("policy.unchanged", m.policyChange === null, "no deterministic policy change in this release");
  add("rollback.plan", m.rollback.to === (previous?.release ?? null) && m.rollback.procedure.length > 0, `rollback to ${m.rollback.to ?? "none"}`);
  for (const ap of m.approvals) add(`approval.human:${ap.role}`, HUMAN(ap.name), "approvals must be named humans");
  const prevFiles = new Set(previous?.schema.migrations.map((x) => x.file) ?? []);
  const pendingMigrations = files.filter((f) => !prevFiles.has(f) && !m.authorizations.migrations.some((z) => z.file === f && HUMAN(z.approvedBy)));
  const blocked = checks.some((c) => !c.ok);
  const signed = ["ENGINEERING", "OPERATIONS"].every((r) => m.approvals.some((x) => x.role === r && HUMAN(x.name)));
  const deploy = m.authorizations.deployment.approved && m.authorizations.deployment.by !== null && HUMAN(m.authorizations.deployment.by);
  const verdict: ReleaseVerdict = blocked ? "BLOCKED" : signed && deploy && pendingMigrations.length === 0 ? "APPROVED_FOR_DEPLOYMENT" : "READY_FOR_APPROVAL";
  return { verdict, checks, pendingMigrations };
}

export function loadManifest(releasesDir: string, version: string): ReleaseManifest | null {
  const f = path.join(releasesDir, `${version}.json`);
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as ReleaseManifest) : null;
}
