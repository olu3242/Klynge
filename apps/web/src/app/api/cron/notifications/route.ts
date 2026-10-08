import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { memoryQueueFor } from "@/server/notifications/queue-registry";
import { runNotificationWorker } from "@/server/notifications/worker";
import { clockFrom, processDeps } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Scheduled notification worker for IN-PROCESS stores (memory/file). Requires the server-only KLYNGE_CRON_SECRET.
 * Hosted (Supabase) delivery never runs on a request path: it runs as `npm run worker:notifications` from the
 * scheduler (migration 0003 functions, allow-listed dispatch operation). Overlapping invocations never claim the same row.
 */
export async function POST(req: Request) {
  const secret = process.env.KLYNGE_CRON_SECRET;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) return new NextResponse(null, { status: 401 });
  const p = processDeps();
  if (!p.email) return NextResponse.json({ error: "Dispatch is not available for this email configuration" }, { status: 501 });
  if (!p.account) return NextResponse.json({ error: "Hosted dispatch runs as the scheduled worker, not on this route" }, { status: 501 });
  const queue = memoryQueueFor(p.account);
  const now = clockFrom(req.headers);
  const t0 = Date.now();
  try {
    const run = await runNotificationWorker(queue, p.email, { workerId: `cron-${randomUUID().slice(0, 8)}`, now, clock: () => now + (Date.now() - t0) });
    return NextResponse.json({ delivered: run.delivered, failed: run.failed, deferred: run.deferred, suppressed: run.suppressed, leaseLost: run.leaseLost });
  } catch {
    return NextResponse.json({ error: "Notification worker failed; rows stay leased until expiry and are retried" }, { status: 503 });
  }
}

