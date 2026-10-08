import { NextResponse } from "next/server";
import { errorResponse, requestContext } from "@/server/http";
import { history } from "@/server/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { identity, deps } = await requestContext();
    const symbol = new URL(req.url).searchParams.get("symbol")?.toUpperCase() || undefined;
    return NextResponse.json(await history(deps, identity.tenantId, symbol));
  } catch (e) {
    return errorResponse(e);
  }
}
