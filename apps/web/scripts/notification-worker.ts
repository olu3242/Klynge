/**
 * Hosted notification worker (Batch 67). Run by the scheduler (e.g. every minute), never on a request path.
 * Requires migration 0003 applied (explicit approval), SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY and a configured email
 * provider (KLYNGE_EMAIL=resend + RESEND_API_KEY + KLYNGE_EMAIL_FROM). Prints counts only (no addresses or content).
 *   node --conditions=react-server scripts/notification-worker.ts [--once]
 */
import { randomUUID } from "node:crypto";
import { hostedNotificationQueue } from "../src/server/admin/notification-dispatch.ts";
import { runNotificationWorker } from "../src/server/notifications/worker.ts";
import { emailFromEnv } from "../src/server/runtime.ts";

for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[k]) {
    console.error(`BLOCKED: ${k} is not configured (server-only). The hosted worker cannot run.`);
    process.exit(3);
  }
}
const email = emailFromEnv(process.env);
if (!email || email.id === "mock-email") {
  console.error("BLOCKED: no production email provider (KLYNGE_EMAIL=resend with RESEND_API_KEY + KLYNGE_EMAIL_FROM).");
  process.exit(3);
}
const run = await runNotificationWorker(hostedNotificationQueue(process.env), email, { workerId: `sched-${randomUUID().slice(0, 8)}`, now: Date.now(), clock: Date.now });
console.log(JSON.stringify({ runId: run.runId, claimed: run.claimed, delivered: run.delivered, failed: run.failed, deferred: run.deferred, suppressed: run.suppressed, leaseLost: run.leaseLost }));
