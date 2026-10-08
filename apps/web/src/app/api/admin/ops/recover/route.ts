import { NextResponse } from "next/server";
import { requestContext } from "@/server/http";
import { audit } from "@/server/notifications/dispatcher";
import { isOperator, quarantineCorruptedRuntime } from "@/server/ops/operator";
import { clockFrom, processDeps } from "@/server/runtime";
import type { MemorySessionStore } from "@/server/store/memory-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Deterministic recovery (operator only, CSRF-checked by middleware, audited). In-process stores only. */
export async function POST(req: Request) {
  const ctx = await requestContext().catch(() => null);
  if (!ctx || ctx.identity.kind !== "USER" || !isOperator(ctx.identity, ctx.gateway.kind)) return new NextResponse(null, { status: 404 });
  const p = processDeps();
  if (!p.durable) return NextResponse.json({ error: "Hosted recovery runs from the runbook, not on a request path" }, { status: 501 });
  const now = clockFrom(req.headers);
  const quarantined = quarantineCorruptedRuntime(p.durable as MemorySessionStore, now);
  if (p.account) await audit(p.account, ctx.identity.tenantId, now, "ops.recovered", `quarantined ${quarantined} runtime cursor(s)`);
  return NextResponse.json({ quarantined });
}
