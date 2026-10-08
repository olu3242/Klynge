import { NextResponse } from "next/server";
import { errorResponse, requestContext } from "@/server/http";
import { onboarding, updateOnboarding } from "@/server/pilot/pilot";
import { clockFrom } from "@/server/runtime";
import { WorkspaceError } from "@/server/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { identity, deps } = await requestContext();
    if (identity.kind !== "USER") throw new WorkspaceError("AUTH_REQUIRED", "Sign in to see onboarding.");
    return NextResponse.json(await onboarding(deps, identity.tenantId, identity.sessionId));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    const { identity, deps } = await requestContext();
    if (identity.kind !== "USER") throw new WorkspaceError("AUTH_REQUIRED", "Sign in to save onboarding progress.");
    const body = (await req.json().catch(() => ({}))) as { action?: unknown };
    await updateOnboarding(deps, identity.tenantId, body.action, clockFrom(req.headers));
    return NextResponse.json(await onboarding(deps, identity.tenantId, identity.sessionId));
  } catch (e) {
    return errorResponse(e);
  }
}
