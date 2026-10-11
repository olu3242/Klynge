/**
 * Read-only release-governance diagnostics. Never grants approvals or modifies manifests.
 * Usage (from apps/web): node --import tsx scripts/release-diagnostics.ts
 */
import path from "node:path";
import { actualState, loadManifest, releaseReadiness } from "../src/server/release/manifest.ts";

const appRoot = path.resolve(import.meta.dirname, "..");
const releasesDir = path.resolve(appRoot, "../../releases");
const actual = actualState(appRoot);
const manifest = loadManifest(releasesDir, actual.engineVersion);
if (!manifest) {
  console.error(JSON.stringify({ verdict: "BLOCKED", reason: "MANIFEST_MISSING", engineVersion: actual.engineVersion }, null, 2));
  process.exitCode = 1;
} else {
  const previous = manifest.previousRelease ? loadManifest(releasesDir, manifest.previousRelease) : null;
  if (manifest.previousRelease && !previous) {
    console.error(JSON.stringify({ verdict: "BLOCKED", reason: "PREVIOUS_MANIFEST_MISSING", previousRelease: manifest.previousRelease }, null, 2));
    process.exitCode = 1;
  } else {
    const result = releaseReadiness(manifest, previous, actual);
    console.log(JSON.stringify({
      verdict: result.verdict,
      release: manifest.release,
      actual: { engineVersion: actual.engineVersion, ruleVersion: actual.ruleVersion, appVersion: actual.appVersion },
      manifest: { engineVersion: manifest.engineVersion, ruleVersion: manifest.ruleVersion, appVersion: manifest.appVersion },
      failedChecks: result.checks.filter((check) => !check.ok),
      pendingMigrations: result.pendingMigrations,
      migrationFiles: actual.migrations.map((migration) => migration.file),
    }, null, 2));
    if (result.verdict === "BLOCKED") process.exitCode = 1;
  }
}
