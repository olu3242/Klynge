import { NextResponse } from "next/server";
import { errorResponse, requestContext } from "@/server/http";
import { clockFrom } from "@/server/runtime";
import { statusReport } from "@/server/status";
import { WorkspaceError } from "@/server/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { identity, deps } = await requestContext();
    if (identity.kind !== "USER") throw new WorkspaceError("AUTH_REQUIRED", "Sign in to see your operational status.");
    return NextResponse.json(await statusReport(deps.store, deps.account, deps.market, identity.tenantId, clockFrom(req.headers)));
  } catch (e) {
    return errorResponse(e);
  }
}
