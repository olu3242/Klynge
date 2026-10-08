import { NextResponse } from "next/server";
import { requestContext } from "@/server/http";
import { collectOpsReport, isOperator } from "@/server/ops/operator";
import { clockFrom, processDeps } from "@/server/runtime";
import type { MemorySessionStore } from "@/server/store/memory-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Operator-only aggregates. Everyone else gets 404 (the route's existence is not disclosed). */
export async function GET(req: Request) {
  const ctx = await requestContext().catch(() => null);
  if (!ctx || !isOperator(ctx.identity, ctx.gateway.kind)) return new NextResponse(null, { status: 404 });
  const p = processDeps();
  return NextResponse.json(collectOpsReport({ storeMode: p.storeMode, durable: (p.durable as MemorySessionStore | null) ?? null, account: p.account, market: ctx.deps.market ?? null }, clockFrom(req.headers)), { headers: { "cache-control": "no-store" } });
}
