/**
 * Hosted pilot administration (operators only; manual, never CI). Requires migration 0004 applied with approval and
 * SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. Prints counts/outcomes only — never keys or user data.
 *   npm run pilot:admin -- --operator "Ada Lovelace" summary
 *   npm run pilot:admin -- --operator "Ada Lovelace" invite user@example.com [cohort]
 *   npm run pilot:admin -- --operator "Ada Lovelace" revoke user@example.com
 *   npm run pilot:admin -- --operator "Ada Lovelace" set-status <user-uuid> SUSPENDED|ACTIVE|COMPLETED [reason]
 *   npm run pilot:admin -- --operator "Ada Lovelace" triage <user-uuid> <feedback-id> <STATUS> [KLY-n]
 */
import { hostedPilotAdmin } from "../src/server/admin/pilot-admin.ts";

const argv = process.argv.slice(2);
const oi = argv.indexOf("--operator");
const operator = oi >= 0 ? argv[oi + 1] : undefined;
const rest = oi >= 0 ? [...argv.slice(0, oi), ...argv.slice(oi + 2)] : argv;
if (!operator || operator.trim().length < 3) {
  console.error("usage: --operator <your name> <summary|invite|revoke|set-status|triage> …");
  process.exit(2);
}
for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[k]) {
    console.error(`BLOCKED: ${k} is not configured (server-only).`);
    process.exit(3);
  }
}
const admin = hostedPilotAdmin(operator);
const [cmd, a, b, c, d] = rest;
const now = Date.now();
if (cmd === "summary") console.log(JSON.stringify(await admin.summary()));
else if (cmd === "invite" && a) await admin.invite(a, b ?? "pilot-1", now);
else if (cmd === "revoke" && a) await admin.revoke(a, now);
else if (cmd === "set-status" && a && (b === "ACTIVE" || b === "SUSPENDED" || b === "COMPLETED")) await admin.setStatus(a, b, c ?? null, now);
else if (cmd === "triage" && a && b && c) await admin.triage(a, b, c as never, d ?? null, now);
else {
  console.error("unknown command");
  process.exit(2);
}
console.log(`${cmd}: ok`);
