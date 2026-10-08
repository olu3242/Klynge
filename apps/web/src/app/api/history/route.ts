import { NextResponse } from "next/server";
import { errorResponse, identity } from "@/server/http";
import { runtimeDeps } from "@/server/runtime";
import { history } from "@/server/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { tenantId } = await identity();
    const symbol = new URL(req.url).searchParams.get("symbol")?.toUpperCase() || undefined;
    return NextResponse.json(await history(runtimeDeps(), tenantId, symbol));
  } catch (e) {
    return errorResponse(e);
  }
}
