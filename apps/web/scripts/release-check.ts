/**
 * Release readiness (Batch 79). Compares releases/<version>.json with the code: versions, adapter versions, migration +
 * rollback hashes, the deterministic policy fingerprint, approvals and separate deployment/migration authorizations.
 * It never deploys, migrates or changes policy.
 *   node --conditions=react-server scripts/release-check.ts [--version 0.8.0] [--draft]
 * --draft writes an UNAPPROVED manifest for the current code if none exists (approvals are added by humans).
 */
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { actualState, loadManifest, releaseReadiness } from "../src/server/release/manifest.ts";
import type { ReleaseManifest } from "../src/server/release/manifest.ts";

const APP = path.resolve(import.meta.dirname, "..");
const DIR = path.resolve(APP, "../../releases");
const arg = (k: string) => (process.argv.includes(`--${k}`) ? process.argv[process.argv.indexOf(`--${k}`) + 1] : undefined);
const actual = actualState(APP);
const version = arg("version") ?? actual.engineVersion;
const prevVersion = (process.env.KLYNGE_PREVIOUS_RELEASE ?? "").trim() || null;

if (process.argv.includes("--draft")) {
  const file = path.join(DIR, `${version}.json`);
  if (existsSync(file)) {
    console.error(`${file} exists — drafts never overwrite a manifest`);
    process.exit(2);
  }
  const draft: ReleaseManifest = {
    manifestVersion: 1,
    release: version,
    engineVersion: actual.engineVersion,
    ruleVersion: actual.ruleVersion,
    appVersion: actual.appVersion,
    previousRelease: prevVersion,
    schema: { migrations: actual.migrations.map((m) => ({ file: m.file, sha256: m.sha256, rollback: m.rollback ?? "MISSING", rollbackSha256: m.rollbackSha256 ?? "MISSING" })) },
    adapters: actual.adapters,
    policyFingerprint: actual.policyFingerprint,
    policyChange: null,
    approvals: [],
    authorizations: { deployment: { approved: false, by: null, at: null }, migrations: [] },
    rollback: { to: prevVersion, procedure: "docs/release/governance.md#rollback" },
  };
  writeFileSync(file, `${JSON.stringify(draft, null, 2)}\n`);
  console.log(`draft written: ${path.relative(process.cwd(), file)}`);
}

const manifest = loadManifest(DIR, version);
if (!manifest) {
  console.error(`BLOCKED: no release manifest releases/${version}.json`);
  process.exit(3);
}
const previous = manifest.previousRelease ? loadManifest(DIR, manifest.previousRelease) : null;
const r = releaseReadiness(manifest, previous, actual);
for (const c of r.checks) console.log(`${c.ok ? "✓" : "✗"} ${c.id} — ${c.detail}`);
if (r.pendingMigrations.length) console.log(`migrations awaiting separate authorization: ${r.pendingMigrations.join(", ")}`);
console.log(`\nrelease ${version}: ${r.verdict}`);
process.exit(r.verdict === "BLOCKED" ? 1 : 0);
