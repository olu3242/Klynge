import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { deliverPending } from "@/server/notifications/dispatcher";
import { processDeps } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Scheduled delivery retries (infrastructure job). Requires the server-only KLYNGE_CRON_SECRET. In-process stores
 * only; hosted (Supabase) dispatch must run as the allow-listed "maintenance.cleanup"-class job and is not enabled.
 */
export async function POST(req: Request) {
  const secret = process.env.KLYNGE_CRON_SECRET;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) return new NextResponse(null, { status: 401 });
  const p = processDeps();
  if (!p.account || !p.email) return NextResponse.json({ error: "Dispatch is not available for this store/email configuration" }, { status: 501 });
  const now = Date.now();
  let delivered = 0;
  for (const tenant of p.account.allPendingTenants()) delivered += (await deliverPending(p.account, p.email, tenant, now)).delivered;
  return NextResponse.json({ delivered });
}
