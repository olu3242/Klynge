import { NextResponse } from "next/server";
import { errorResponse, requestContext, withAccount } from "@/server/http";
import { clockFrom } from "@/server/runtime";
import { connectData } from "@/server/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** VISUAL → DATA handoff. Ownership comes from the verified session; the body may carry only a symbol hint + intent. */
export async function POST(req: Request) {
  try {
    const { identity, deps, account } = await requestContext();
    const body = (await req.json().catch(() => ({}))) as { symbol?: unknown; intent?: unknown };
    const view = await connectData(deps, {
      tenantId: identity.tenantId,
      sessionId: identity.sessionId,
      ...(typeof body.symbol === "string" && body.symbol ? { symbol: body.symbol } : {}),
      ...(typeof body.intent === "string" ? { intent: body.intent } : {}),
      now: clockFrom(req.headers),
    });
    return NextResponse.json(withAccount(view, account));
  } catch (e) {
    return errorResponse(e);
  }
}
