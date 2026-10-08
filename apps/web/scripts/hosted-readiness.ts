/**
 * Hosted readiness report (manual). Validates env shape without printing any value, lists pending migrations and
 * their rollbacks. Never connects to or modifies the hosted database.
 *   node --conditions=react-server scripts/hosted-readiness.ts [--project mdshgiqynukrbkyxgmur]
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { readinessSummary, validateHostedEnv } from "../src/server/admin/readiness.ts";

const i = process.argv.indexOf("--project");
const project = i > 0 ? process.argv[i + 1] : undefined;
const checks = validateHostedEnv(process.env, project);
for (const c of checks) console.log(`${c.status === "PASS" ? "✓" : c.status === "WARN" ? "!" : "✗"} ${c.id} — ${c.detail}`);
const dir = path.join(import.meta.dirname, "../supabase");
const ups = readdirSync(path.join(dir, "migrations")).filter((f) => f.endsWith(".sql")).sort();
console.log("\nmigrations (apply in order, with approval):");
for (const f of ups) console.log(`  ${f}  rollback: ${existsSync(path.join(dir, "rollback", f.replace(".sql", ".down.sql"))) ? "yes" : "MISSING"}`);
const s = readinessSummary(checks);
console.log(`\nhosted readiness: ${s.ready ? "READY" : "NOT READY"} (${s.failed.length} failed, ${s.warnings.length} warnings)`);
process.exit(s.ready ? 0 : 1);
