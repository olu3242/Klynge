import { NextResponse } from "next/server";
import { errorResponse, identity } from "@/server/http";
import { runtimeDeps } from "@/server/runtime";
import { getWorkspace } from "@/server/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { tenantId, sessionId } = await identity();
    return NextResponse.json(await getWorkspace(runtimeDeps(), tenantId, sessionId));
  } catch (e) {
    return errorResponse(e);
  }
}
