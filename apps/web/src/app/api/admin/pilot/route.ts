import { NextResponse } from "next/server";
import { requestContext } from "@/server/http";
import { isOperator } from "@/server/ops/operator";
import { AdminActionError, adminAction } from "@/server/pilot/admin";
import type { AdminAction } from "@/server/pilot/admin";
import { controlPlane } from "@/server/pilot/control-plane";
import { clockFrom, processDeps } from "@/server/runtime";
import type { MemorySessionStore } from "@/server/store/memory-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function operator() {
  const ctx = await requestContext({ pilotGate: false }).catch(() => null);
  return ctx && ctx.identity.kind === "USER" && isOperator(ctx.identity, ctx.gateway.kind) ? ctx : null;
}

/** Pilot control plane (operators only; 404 for everyone else). */
export async function GET(req: Request) {
  const ctx = await operator();
  if (!ctx) return new NextResponse(null, { status: 404 });
  const p = processDeps();
  return NextResponse.json(controlPlane({ storeMode: p.storeMode, durable: (p.durable as MemorySessionStore | null) ?? null, account: p.account, market: ctx.deps.market ?? null, pilot: p.pilot }, clockFrom(req.headers)), { headers: { "cache-control": "no-store" } });
}

/** Authorized, audited operator actions. None of them can create, edit or upgrade a decision. */
export async function POST(req: Request) {
  const ctx = await operator();
  if (!ctx || ctx.identity.kind !== "USER") return new NextResponse(null, { status: 404 });
  const p = processDeps();
  if (!p.pilot) return NextResponse.json({ error: "Hosted pilot administration runs via `npm run pilot:admin`" }, { status: 501 });
  try {
    const body = (await req.json().catch(() => ({}))) as AdminAction;
    return NextResponse.json(await adminAction({ pilot: p.pilot, account: p.account, durable: (p.durable as MemorySessionStore | null) ?? null }, ctx.identity.user.id, body, clockFrom(req.headers)));
  } catch (e) {
    if (e instanceof AdminActionError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
