import { NextResponse } from "next/server";
import { errorResponse, requestContext, withAccount } from "@/server/http";
import { getWorkspace } from "@/server/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { identity, deps, account } = await requestContext();
    return NextResponse.json(withAccount(await getWorkspace(deps, identity.tenantId, identity.sessionId), account));
  } catch (e) {
    return errorResponse(e);
  }
}
