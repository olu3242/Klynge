import { NextResponse } from "next/server";
import { errorResponse, identity } from "@/server/http";
import { clockFrom, runtimeDeps } from "@/server/runtime";
import { importOhlcv, WorkspaceError } from "@/server/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_JSON_BYTES = 8 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    const { tenantId, sessionId } = await identity();
    const text = await req.text();
    if (text.length > MAX_JSON_BYTES) throw new WorkspaceError("INVALID", "OHLCV import too large");
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new WorkspaceError("INVALID", "OHLCV import must be JSON");
    }
    return NextResponse.json(await importOhlcv(runtimeDeps(), { tenantId, sessionId, json, now: clockFrom(req.headers) }));
  } catch (e) {
    return errorResponse(e);
  }
}
